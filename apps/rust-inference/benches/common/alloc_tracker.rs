use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct TrackingAllocator {
    allocated_bytes: AtomicUsize,
    deallocated_bytes: AtomicUsize,
    allocation_count: AtomicUsize,
    deallocation_count: AtomicUsize,
}

impl Default for TrackingAllocator {
    fn default() -> Self {
        Self::new()
    }
}

impl TrackingAllocator {
    pub const fn new() -> Self {
        Self {
            allocated_bytes: AtomicUsize::new(0),
            deallocated_bytes: AtomicUsize::new(0),
            allocation_count: AtomicUsize::new(0),
            deallocation_count: AtomicUsize::new(0),
        }
    }

    pub fn snapshot(&self) -> AllocSnapshot {
        AllocSnapshot {
            allocated_bytes: self.allocated_bytes.load(Ordering::SeqCst),
            deallocated_bytes: self.deallocated_bytes.load(Ordering::SeqCst),
            allocation_count: self.allocation_count.load(Ordering::SeqCst),
            deallocation_count: self.deallocation_count.load(Ordering::SeqCst),
        }
    }

    pub fn measure<R>(&self, f: impl FnOnce() -> R) -> (R, AllocDiff) {
        let before = self.snapshot();
        let result = f();
        let after = self.snapshot();
        (result, before.diff(&after))
    }
}

unsafe impl GlobalAlloc for TrackingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let ptr = System.alloc(layout);
        if !ptr.is_null() {
            self.allocated_bytes
                .fetch_add(layout.size(), Ordering::SeqCst);
            self.allocation_count.fetch_add(1, Ordering::SeqCst);
        }
        ptr
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout);
        self.deallocated_bytes
            .fetch_add(layout.size(), Ordering::SeqCst);
        self.deallocation_count.fetch_add(1, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, Copy)]
pub struct AllocSnapshot {
    pub allocated_bytes: usize,
    pub deallocated_bytes: usize,
    pub allocation_count: usize,
    pub deallocation_count: usize,
}

impl AllocSnapshot {
    pub fn diff(&self, other: &AllocSnapshot) -> AllocDiff {
        AllocDiff {
            alloc_count: other.allocation_count.saturating_sub(self.allocation_count),
            bytes_allocated: other.allocated_bytes.saturating_sub(self.allocated_bytes),
            dealloc_count: other
                .deallocation_count
                .saturating_sub(self.deallocation_count),
            bytes_deallocated: other
                .deallocated_bytes
                .saturating_sub(self.deallocated_bytes),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct AllocDiff {
    pub alloc_count: usize,
    pub bytes_allocated: usize,
    pub dealloc_count: usize,
    pub bytes_deallocated: usize,
}

impl AllocDiff {
    pub fn print(&self, name: &str) {
        eprintln!(
            "  [ALLOC PROFILE: {:<28}] Allocs: {:>6} (free: {:>6}) | Total Bytes: {:>9} B ({:>6.2} KB) | Net Churn: {:>9} B",
            name,
            self.alloc_count,
            self.dealloc_count,
            self.bytes_allocated,
            self.bytes_allocated as f64 / 1024.0,
            self.bytes_allocated.saturating_sub(self.bytes_deallocated)
        );
    }
}
