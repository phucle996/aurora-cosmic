package physics

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"

	"go-api/internal/domain/entity"
)

// ============================================================================
// HẰNG SỐ VẬT LÝ & THIÊN VĂN (Astronomical Constants & Baselines)
// ============================================================================
const (
	// Phiên bản mô hình vật lý và đánh giá khả năng hỗ trợ sự sống
	modelVersion      = "planet-physics-solar-baseline-v1"
	assessmentVersion = "habitability-physics-v1"

	// Nhiệt độ hiệu dụng của Mặt Trời (Kelvin)
	solarTeffK = 5772.0

	// Bán kính Mặt Trời quy đổi ra đơn vị thiên văn AU (1 R_sun ≈ 0.00465047 AU)
	solarRadiusAU = 0.00465047

	// Tỷ lệ bán kính Mặt Trời so với bán kính Trái Đất (1 R_sun ≈ 109.076 R_earth)
	earthsPerSun = 109.076

	// Hệ số phản xạ Bond Albedo giả định (0.30 - tương đương Trái Đất)
	bondAlbedo = 0.30
)

// ============================================================================
// HÀM SUY DIỄN ĐẶC TÍNH VẬT LÝ ỨNG VIÊN (Derive Physical Properties)
// ============================================================================
// DeriveCandidate chuyển đổi các bằng chứng quan sát từ thuật toán BLS (Box Least Squares)
// và danh mục sao TIC (TESS Input Catalog) thành các ước lượng vật lý minh bạch.
//
// Nguyên tắc: Không bao giờ tự ý bịa/điền bừa (impute) giá trị thiếu, mà sẽ báo cáo
// mọi giới hạn dữ liệu vào danh sách Warnings.
func DeriveCandidate(candidate entity.Candidate, evidence entity.CandidateEvidence) (entity.PlanetPhysics, entity.HabitabilityAssessment) {
	// 1. Khởi tạo cấu trúc kết quả vật lý với các giá trị mặc định
	result := entity.PlanetPhysics{
		PlanetCandidateID:       candidateID(candidate, evidence),
		ModelVersion:            modelVersion,
		BondAlbedoAssumption:    bondAlbedo,
		HZClassification:        "unknown",
		ConservativeHZInnerFlux: 1.06, // Ranh giới trong vùng bảo thủ (Inner Conservative HZ)
		ConservativeHZOuterFlux: 0.36, // Ranh giới ngoài vùng bảo thủ (Outer Conservative HZ)
		OptimisticHZInnerFlux:   1.78, // Ranh giới trong vùng lạc quan (Inner Optimistic HZ)
		OptimisticHZOuterFlux:   0.32, // Ranh giới ngoài vùng lạc quan (Outer Optimistic HZ)
		Warnings:                []string{},
	}

	available := 0.0
	const expected = 5.0 // 5 tham số đầu vào kỳ vọng: Chu kỳ, Độ sâu transit, Bán kính sao, Khối lượng sao, Nhiệt độ sao

	// 2. Thu thập và kiểm tra tính hợp lệ của từng tham số đầu vào
	// - Chu kỳ quỹ đạo từ thuật toán BLS (Orbital Period)
	if evidence.BLSAvailable && finitePositive(evidence.BLSPeriod) {
		result.OrbitalPeriodDays = ptr(evidence.BLSPeriod)
		available++
	} else {
		result.Warnings = append(result.Warnings, "orbital_period_missing")
	}

	// - Độ sâu transit từ thuật toán BLS (Transit Depth: tỉ lệ độ sáng giảm)
	if evidence.BLSAvailable && evidence.BLSDepth > 0 && evidence.BLSDepth < 1 && isFinite(evidence.BLSDepth) {
		result.TransitDepthFraction = ptr(evidence.BLSDepth)
		available++
	} else {
		result.Warnings = append(result.Warnings, "transit_depth_missing_or_invalid")
	}

	// - Bán kính sao mẹ (Stellar Radius tính theo bán kính Mặt Trời R_sun)
	if finitePositive(evidence.StellarRadius) {
		available++
	} else {
		result.Warnings = append(result.Warnings, "stellar_radius_missing")
	}

	// - Khối lượng sao mẹ (Stellar Mass tính theo khối lượng Mặt Trời M_sun)
	if finitePositive(evidence.StellarMass) {
		available++
	} else {
		result.Warnings = append(result.Warnings, "stellar_mass_missing")
	}

	// - Nhiệt độ hiệu dụng của sao mẹ (Effective Temperature T_eff tính theo Kelvin)
	if finitePositive(evidence.Teff) {
		available++
		if evidence.Teff < 4000 || evidence.Teff > 7000 {
			result.Warnings = append(result.Warnings, "stellar_temperature_outside_solar_baseline_range")
		}
	} else {
		result.Warnings = append(result.Warnings, "stellar_temperature_missing")
	}

	// Độ hoàn thiện dữ liệu đầu vào (từ 0.0 đến 1.0)
	result.Completeness = available / expected

	// 3. Tính toán các đại lượng vật lý giải tích nếu có đủ tham số

	// a. Bán kính hành tinh (R_p tính theo R_earth): R_p = sqrt(depth) * R_star * earthsPerSun
	if result.TransitDepthFraction != nil && finitePositive(evidence.StellarRadius) {
		result.PlanetRadiusEarth = ptr(math.Sqrt(*result.TransitDepthFraction) * evidence.StellarRadius * earthsPerSun)
	}

	// b. Bán trục lớn quỹ đạo (Semi-major axis `a` tính theo AU) theo Định luật 3 Kepler: a = (M_star * P_year^2)^(1/3)
	if result.OrbitalPeriodDays != nil && finitePositive(evidence.StellarMass) {
		periodYears := *result.OrbitalPeriodDays / 365.25
		result.SemiMajorAxisAU = ptr(math.Cbrt(evidence.StellarMass * periodYears * periodYears))
	}

	// c. Độ sáng sao mẹ (Luminosity `L_star` so với Mặt Trời) theo Định luật Stefan-Boltzmann: L = R^2 * (T_eff / T_sun)^4
	if finitePositive(evidence.StellarRadius) && finitePositive(evidence.Teff) {
		result.StellarLuminositySolar = ptr(evidence.StellarRadius * evidence.StellarRadius * math.Pow(evidence.Teff/solarTeffK, 4))
	}

	// d. Bức xạ nhận được (Insolation S_eff), Nhiệt độ cân bằng (T_eq), và Phân loại Habitable Zone
	if result.StellarLuminositySolar != nil && result.SemiMajorAxisAU != nil && *result.SemiMajorAxisAU > 0 {
		// Bức xạ bề mặt nhận được so với Trái Đất: S_eff = L_star / a^2
		result.InsolationEarth = ptr(*result.StellarLuminositySolar / (*result.SemiMajorAxisAU * *result.SemiMajorAxisAU))

		// Nhiệt độ cân bằng: T_eq = T_eff * sqrt((R_star * R_sun_AU) / (2 * a)) * (1 - albedo)^0.25
		result.EquilibriumTemperatureK = ptr(evidence.Teff * math.Sqrt((evidence.StellarRadius*solarRadiusAU)/(2**result.SemiMajorAxisAU)) * math.Pow(1-bondAlbedo, 0.25))

		// Phân loại vùng sống được dựa trên thông lượng bức xạ S_eff
		result.HZClassification = classifyHZ(*result.InsolationEarth)
	}

	// Trả về kết quả vật lý cùng với bảng đánh giá điểm số Habitability
	return result, assess(result, evidence)
}

// ============================================================================
// HÀM CHẤM ĐIỂM & ĐÁNH GIÁ KHẢ NĂNG SỐNG ĐƯỢC (Habitability Assessment)
// ============================================================================
// assess chấm điểm theo thang 100 điểm với 5 tiêu chí rõ ràng, minh bạch (Explainable).
func assess(p entity.PlanetPhysics, evidence entity.CandidateEvidence) entity.HabitabilityAssessment {
	assessment := entity.HabitabilityAssessment{
		AssessmentVersion: assessmentVersion,
		Status:            "insufficient_data", // Mặc định khi chưa đủ dữ liệu
		Confidence:        p.Completeness,
		Tier:              "not_assessed",
		Components:        []entity.HabitabilityComponent{},
		MLStatus:          "not_evaluated", // ML riêng biệt, chưa đánh giá
		Disclaimer:        "Physics-based prioritization only; it is not evidence of life or confirmed habitability.",
	}

	// 1. TIÊU CHÍ 1: Vị trí trong Vùng có thể sống được (Habitable Zone - Tối đa 40 điểm)
	zone := component("habitable_zone", "Habitable-zone position", 40)
	if p.InsolationEarth != nil {
		zone.Available = true
		switch p.HZClassification {
		case "conservative":
			zone.Score, zone.Reason = 40, "Incident flux is inside the conservative solar-baseline zone."
		case "optimistic":
			zone.Score, zone.Reason = 26, "Incident flux is inside the optimistic solar-baseline zone."
		default:
			zone.Score, zone.Reason = 4, "Incident flux is outside the optimistic solar-baseline zone."
		}
	} else {
		zone.Reason = "Requires stellar luminosity and semi-major axis."
	}

	// 2. TIÊU CHÍ 2: Khả năng là hành tinh đất đá dựa theo kích thước (Rocky Likelihood - Tối đa 20 điểm)
	rocky := component("rocky_likelihood", "Rocky-size likelihood", 20)
	if p.PlanetRadiusEarth != nil {
		rocky.Available = true
		r := *p.PlanetRadiusEarth
		switch {
		case r <= 1.6:
			// Bán kính <= 1.6 R_earth: khả năng cao là hành tinh đất đá kiểu Trái Đất
			rocky.Score, rocky.Reason = 20, "Radius is compatible with a predominantly rocky planet."
		case r <= 2.5:
			// 1.6 < Bán kính <= 2.5 R_earth: vùng chuyển tiếp Siêu Trái Đất (Super-Earth) / Sub-Neptune
			rocky.Score, rocky.Reason = 10, "Radius is in the super-Earth/sub-Neptune transition region."
		default:
			// Bán kính > 2.5 R_earth: thiên về hành tinh khí khổng lồ hoặc nhiều chất dễ bay hơi
			rocky.Score, rocky.Reason = 2, "Radius favors a volatile-rich or giant planet."
		}
	} else {
		rocky.Reason = "Requires transit depth and stellar radius."
	}

	// 3. TIÊU CHÍ 3: Nhiệt độ cân bằng bề mặt (Equilibrium Temperature - Tối đa 15 điểm)
	thermal := component("equilibrium_temperature", "Equilibrium temperature", 15)
	if p.EquilibriumTemperatureK != nil {
		thermal.Available = true
		t := *p.EquilibriumTemperatureK
		switch {
		case t >= 200 && t <= 320:
			// 200K - 320K: khoảng nhiệt độ lý tưởng cho nước lỏng tồn tại
			thermal.Score, thermal.Reason = 15, "Estimated equilibrium temperature is in the temperate screening band."
		case t >= 150 && t <= 380:
			// Cận biên vùng ôn hòa
			thermal.Score, thermal.Reason = 8, "Estimated temperature is near the temperate screening band."
		default:
			// Quá nóng hoặc quá lạnh
			thermal.Score, thermal.Reason = 1, "Estimated temperature is outside the temperate screening band."
		}
	} else {
		thermal.Reason = "Requires stellar and orbital estimates."
	}

	// 4. TIÊU CHÍ 4: Môi trường sao mẹ (Stellar Environment - Tối đa 15 điểm)
	stellar := component("stellar_environment", "Stellar environment", 15)
	if finitePositive(evidence.Teff) {
		stellar.Available = true
		switch {
		case evidence.Teff >= 4000 && evidence.Teff <= 6500:
			// Sao quang phổ loại G/K ổn định (giống Mặt Trời)
			stellar.Score, stellar.Reason = 15, "Host temperature is within the baseline model's best-supported band."
		case evidence.Teff >= 3000 && evidence.Teff <= 7500:
			stellar.Score, stellar.Reason = 8, "Host temperature needs activity and atmosphere follow-up."
		default:
			stellar.Score, stellar.Reason = 3, "Host temperature is outside the preferred screening band."
		}
	} else {
		stellar.Reason = "Host-star temperature is missing."
	}

	// 5. TIÊU CHÍ 5: Độ đầy đủ của dữ liệu đầu vào (Data Completeness - Tối đa 10 điểm)
	quality := component("data_quality", "Input completeness", 10)
	quality.Available = true
	quality.Score = math.Round(p.Completeness*quality.MaxScore*10) / 10
	quality.Reason = fmt.Sprintf("%.0f%% of required physical inputs are present.", p.Completeness*100)

	// Gom tất cả các tiêu chí vào bảng đánh giá
	assessment.Components = []entity.HabitabilityComponent{zone, rocky, thermal, stellar, quality}

	// Bắt buộc phải có cả 2 thông số cốt lõi: Vị trí Habitable Zone và Bán kính hành tinh
	if !zone.Available || !rocky.Available {
		return assessment
	}

	// Tính tổng điểm (tối đa 100 điểm)
	total := 0.0
	for _, c := range assessment.Components {
		total += c.Score
	}
	total = math.Max(0, math.Min(100, total))
	assessment.PhysicsScore = ptr(math.Round(total*10) / 10)
	assessment.Status = "evaluated"

	// Phân tầng mức độ ưu tiên theo tổng điểm
	switch {
	case total >= 75:
		assessment.Tier = "high_priority" // Ưu tiên cao nhất
	case total >= 50:
		assessment.Tier = "promising" // Triển vọng
	case total >= 25:
		assessment.Tier = "low_priority" // Ưu tiên thấp
	default:
		assessment.Tier = "unlikely" // Khó có khả năng
	}
	return assessment
}

// ============================================================================
// HÀM TIỆN ÍCH PHỤ TRỢ (Helper Functions)
// ============================================================================

// component khởi tạo một tiêu chí thành phần trong đánh giá
func component(key, label string, max float64) entity.HabitabilityComponent {
	return entity.HabitabilityComponent{Key: key, Label: label, MaxScore: max}
}

// classifyHZ phân loại dải Habitable Zone dựa vào bức xạ nhận được (Insolation Flux)
func classifyHZ(flux float64) string {
	if flux >= 0.36 && flux <= 1.06 {
		return "conservative" // Vùng bảo thủ (Conservative Habitable Zone)
	}
	if flux >= 0.32 && flux <= 1.78 {
		return "optimistic" // Vùng lạc quan (Optimistic Habitable Zone)
	}
	return "outside" // Nằm ngoài Habitable Zone
}

// candidateID tạo mã định danh duy nhất (SHA-256) dựa trên các thuộc tính của tín hiệu ứng viên
func candidateID(c entity.Candidate, e entity.CandidateEvidence) string {
	seed := fmt.Sprintf("tic:%d|sector:%d|source:%s|period:%.12g|epoch:%.12g|duration:%.12g|v1", c.TICID, c.Sector, c.SourceProductID, e.BLSPeriod, e.BLSTransitTime, e.BLSDuration)
	sum := sha256.Sum256([]byte(seed))
	return "pc_" + hex.EncodeToString(sum[:12])
}

// isFinite kiểm tra giá trị số thực không bị NaN hoặc Inf
func isFinite(value float64) bool { return !math.IsNaN(value) && !math.IsInf(value, 0) }

// finitePositive kiểm tra giá trị số thực hợp lệ và mang giá trị dương (> 0)
func finitePositive(value float64) bool { return isFinite(value) && value > 0 }

// ptr trả về con trỏ tới một giá trị float64
func ptr(value float64) *float64 { return &value }
