package service

import (
	"context"
	"math"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
	"go-api/internal/physics"
)

// TargetService chịu trách nhiệm quản lý danh mục sao mục tiêu TIC và dữ liệu trắc quang quang phổ.
type TargetService struct {
	targetRepo repo.TargetRepository
}

// NewTargetService khởi tạo TargetService
func NewTargetService(targetRepo repo.TargetRepository) domainService.Target {
	return &TargetService{
		targetRepo: targetRepo,
	}
}

// ListTargets tìm kiếm và lọc danh sách các ngôi sao mục tiêu quan sát (TIC Targets)
func (s *TargetService) ListTargets(ctx context.Context, query entity.TargetQuery) (entity.Page[entity.Target], error) {
	return s.targetRepo.ListTargets(ctx, query)
}

// GetTargetInsight truy vấn thông tin chi tiết một ngôi sao mục tiêu theo TIC ID và Sector,
// đồng thời tính toán các chỉ số vật lý thiên văn chuẩn xác (Harvard spectral type, HZ, density, escape vel, BLS).
func (s *TargetService) GetTargetInsight(ctx context.Context, ticID int64, sector int, snapshotID string) (*entity.TargetInsightResponse, error) {
	record, err := s.targetRepo.GetTargetInsight(ctx, ticID, sector, snapshotID)
	if err != nil {
		return nil, err
	}

	target := record.Target
	evidence := record.Evidence

	// 1. Observation Insight
	matchedTOI := ""
	if target.TOI != "" {
		if strings.HasPrefix(strings.ToUpper(target.TOI), "TOI") {
			matchedTOI = target.TOI
		} else {
			matchedTOI = "TOI " + target.TOI
		}
	}

	samplingCadence := 2.0
	if evidence != nil && evidence.MedianCadence > 0 {
		samplingCadence = evidence.MedianCadence * 24.0 * 60.0
	} else if target.LightcurvePoints > 0 && target.LightcurveTimeSpan > 0 {
		samplingCadence = (target.LightcurveTimeSpan * 24.0 * 60.0) / float64(target.LightcurvePoints)
	}

	maxGapDays := 0.0
	maxGapHours := 0.0
	photometricNoisePPM := 0.0
	if evidence != nil {
		maxGapDays = evidence.MaxGap
		maxGapHours = evidence.MaxGap * 24.0
		if evidence.FluxStd > 0 {
			photometricNoisePPM = math.Round(evidence.FluxStd * 1e6)
		}
	}

	obsInsight := entity.TargetObservationInsight{
		TessMag:                target.TessMag,
		Sector:                 target.Sector,
		RA:                     target.RA,
		Dec:                    target.Dec,
		MatchedTOI:             matchedTOI,
		SamplingCadenceMinutes: samplingCadence,
		LightcurvePoints:       target.LightcurvePoints,
		LightcurveTimeSpanDays: target.LightcurveTimeSpan,
		MaxDataGapDays:         maxGapDays,
		MaxDataGapHours:        maxGapHours,
		PhotometricNoisePPM:    photometricNoisePPM,
	}

	// 2. Stellar Physics Insight
	teff := target.EffectiveT
	if teff <= 0 && evidence != nil && evidence.Teff > 0 {
		teff = evidence.Teff
	}

	radius := target.Radius
	if radius <= 0 && evidence != nil && evidence.StellarRadius > 0 {
		radius = evidence.StellarRadius
	}

	mass := 0.0
	if evidence != nil && evidence.StellarMass > 0 {
		mass = evidence.StellarMass
	} else if radius > 0 && teff > 0 {
		mass = math.Pow(radius, 1.25)
	}

	logg := target.SurfaceGrav
	if logg <= 0 && evidence != nil && evidence.LogG > 0 {
		logg = evidence.LogG
	}

	specType := "M"
	if teff >= 7500 {
		specType = "A"
	} else if teff >= 6000 {
		specType = "F"
	} else if teff >= 5200 {
		specType = "G"
	} else if teff >= 3700 {
		specType = "K"
	}

	isGiant := radius >= 8.0
	isSubgiant := radius >= 2.0 && radius < 8.0
	lumClass := "Solar-type"
	if isGiant {
		lumClass = "Giant"
	} else if isSubgiant {
		lumClass = "Subgiant"
	} else {
		switch specType {
		case "M":
			lumClass = "Red Dwarf"
		case "K":
			lumClass = "Orange Dwarf"
		case "G":
			lumClass = "Solar-type"
		case "F":
			lumClass = "Yellow-White"
		case "A":
			lumClass = "White"
		}
	}
	spectralLabel := specType + "-type (" + lumClass + ")"
	evolutionStatus := "Stable Main-Sequence"
	if isGiant || isSubgiant {
		evolutionStatus = "Evolved / Post-Main Sequence"
	}

	stellarDensity := 0.0
	if mass > 0 && radius > 0 {
		stellarDensity = (mass / math.Pow(radius, 3)) * 1.408
	}

	escapeVel := 0.0
	if mass > 0 && radius > 0 {
		escapeVel = 617.5 * math.Sqrt(mass/radius)
	}

	luminosity := 0.0
	if radius > 0 && teff > 0 {
		luminosity = math.Pow(radius, 2) * math.Pow(teff/5778.0, 4)
	}

	var bolometricMag *float64
	if luminosity > 0 {
		mbol := 4.74 - 2.5*math.Log10(luminosity)
		bolometricMag = &mbol
	}

	hzInner := 0.0
	hzOuter := 0.0
	if luminosity > 0 {
		hzInner = 0.95 * math.Sqrt(luminosity)
		hzOuter = 1.67 * math.Sqrt(luminosity)
	}

	var fluxStdPPM *float64
	var fluxAmplitudePct *float64
	if evidence != nil {
		if evidence.FluxStd > 0 {
			ppm := math.Round(evidence.FluxStd * 1e6)
			fluxStdPPM = &ppm
		}
		if evidence.FluxAmplitude > 0 {
			pct := evidence.FluxAmplitude * 100.0
			fluxAmplitudePct = &pct
		}
	}

	stellarInsight := entity.TargetStellarPhysicsInsight{
		Teff:               teff,
		Radius:             radius,
		Mass:               mass,
		LogG:               logg,
		SpectralClassLabel: spectralLabel,
		EvolutionStatus:    evolutionStatus,
		StellarDensityGCC:  stellarDensity,
		EscapeVelocityKMS:  escapeVel,
		BolometricMag:      bolometricMag,
		HZInnerAU:          hzInner,
		HZOuterAU:          hzOuter,
		HZLuminositySolar:  luminosity,
		FluxStdPPM:         fluxStdPPM,
		FluxAmplitudePct:   fluxAmplitudePct,
	}

	// 3. AI & Planetary Insights
	aiInsight := entity.TargetAIInsights{
		HZClassification:        "unknown",
		CandidateAboveThreshold: target.CandidateAboveThreshold,
		CandidatePredictionID:   target.CandidatePredictionID,
		Warnings:                []string{},
	}
	if target.HasCandidate && target.CandidateScore > 0 {
		aiInsight.CandidateScore = &target.CandidateScore
	}

	if evidence != nil {
		if evidence.BLSAvailable && evidence.BLSPeriod > 0 {
			aiInsight.BLSPeriodDays = &evidence.BLSPeriod
		}
		if evidence.BLSAvailable && evidence.BLSDepth > 0 {
			aiInsight.BLSDepthFraction = &evidence.BLSDepth
		}
		if evidence.BLSAvailable && evidence.BLSDuration > 0 {
			aiInsight.BLSDurationDays = &evidence.BLSDuration
		}
		if evidence.BLSAvailable && evidence.BLSTransitTime > 0 {
			aiInsight.BLSTransitTime = &evidence.BLSTransitTime
		}

		phys, hab := physics.DeriveTargetPhysics(target.TICID, target.Sector, *evidence)
		aiInsight.SemiMajorAxisAU = phys.SemiMajorAxisAU
		aiInsight.PlanetRadiusEarth = phys.PlanetRadiusEarth
		aiInsight.EquilibriumTempK = phys.EquilibriumTemperatureK
		aiInsight.HZClassification = phys.HZClassification
		aiInsight.InsolationEarth = phys.InsolationEarth
		aiInsight.PlanetClassification = phys.PlanetClassification
		aiInsight.TransitDurationHours = phys.TransitDurationHours
		aiInsight.Warnings = phys.Warnings

		aiInsight.HabitabilityScore = hab.PhysicsScore
		aiInsight.HabitabilityConfidence = hab.Confidence
		aiInsight.HabitabilityTier = hab.Tier
		aiInsight.HabitabilityComponents = hab.Components
	}

	return &entity.TargetInsightResponse{
		Target: target,
		Insights: entity.TargetInsights{
			Observation:    obsInsight,
			StellarPhysics: stellarInsight,
			AIInsights:     aiInsight,
		},
	}, nil
}

// GetTargetObservation truy vấn dữ liệu quan sát thời gian thực gồm đường cong ánh sáng (LC) và ma trận điểm ảnh TPF
func (s *TargetService) GetTargetObservation(ctx context.Context, ticID int64, sector int, limit int) (*entity.TargetObservationResponse, error) {
	return s.targetRepo.GetTargetObservation(ctx, ticID, sector, limit)
}

// GetLightcurve phân trang chuỗi dữ liệu đường cong ánh sáng (Flux time-series) của một ngôi sao
func (s *TargetService) GetLightcurve(ctx context.Context, ticID int64, sector int, page entity.PageRequest) (*entity.Lightcurve, error) {
	return s.targetRepo.GetLightcurve(ctx, ticID, sector, page)
}
