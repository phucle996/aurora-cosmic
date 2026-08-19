import type { JSX } from 'react';
import { Workflow, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import type { Hop } from '../types';

export function HopDetailDrawer({
  selectedHop,
  onClose,
}: {
  selectedHop: Hop | undefined;
  onClose: () => void;
}): JSX.Element {
  return (
    <Drawer
      open={selectedHop !== undefined}
      snapPoints={[0.5, 0.85]}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent className="h-[85vh] max-h-[85vh] border-t-2 border-primary/40">
        <DrawerHeader className="border-b border-border pr-12 text-left">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DrawerTitle className="text-lg font-bold flex items-center gap-2">
                <Workflow className="size-5 text-primary" />
                {selectedHop?.label ?? 'Chi tiết bước xử lý'}
              </DrawerTitle>
              <DrawerDescription className="text-xs">
                {selectedHop?.description ?? 'Đặc tả hợp đồng và dữ liệu đầu vào/đầu ra.'}
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon-sm">
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="overflow-y-auto p-6 space-y-5 max-w-4xl mx-auto text-xs">
          {selectedHop ? (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="bg-muted/20 p-3 rounded border border-border/50">
                  <span className="text-muted-foreground block text-[11px]">Trạng thái</span>
                  <span className="font-semibold text-foreground uppercase">{selectedHop.status}</span>
                </div>
                <div className="bg-muted/20 p-3 rounded border border-border/50">
                  <span className="text-muted-foreground block text-[11px]">Đầu vào (Input)</span>
                  <span className="font-semibold text-foreground">{selectedHop.input}</span>
                </div>
                <div className="bg-muted/20 p-3 rounded border border-border/50">
                  <span className="text-muted-foreground block text-[11px]">Đầu ra (Output)</span>
                  <span className="font-semibold text-foreground">{selectedHop.output}</span>
                </div>
              </div>

              <div className="bg-muted/15 p-4 rounded-lg border border-border/60 space-y-2">
                <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold">
                  Mục tiêu Khoa học Thiên văn
                </span>
                <p className="text-sm font-medium text-foreground">{selectedHop.astronomyGoal}</p>
                {selectedHop.formula && (
                  <div className="mt-2 bg-background p-2.5 rounded font-mono text-xs text-primary border border-border/50">
                    {selectedHop.formula}
                  </div>
                )}
              </div>

              <div className="bg-muted/15 p-4 rounded-lg border border-border/60">
                <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold">
                  Hợp đồng Dữ liệu (Data Contract URI)
                </span>
                <p className="mt-1 font-mono text-xs text-foreground bg-background p-2 rounded border border-border/50 break-all">
                  {selectedHop.contract}
                </p>
              </div>
            </>
          ) : (
            <div className="py-8 text-center text-muted-foreground">Chọn một node để xem chi tiết.</div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
