package physics

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"

	"go-api/internal/domain/entity"
)

const (
	modelVersion      = "planet-physics-solar-baseline-v1"
	assessmentVersion = "habitability-physics-v1"
	solarTeffK        = 5772.0
	solarRadiusAU     = 0.00465047
	earthsPerSun      = 109.076
	bondAlbedo        = 0.30
)

// DeriveCandidate turns BLS and TIC evidence into transparent physical
// estimates. It never imputes absent catalog values and reports every important
// limitation in Warnings.
func DeriveCandidate(candidate entity.Candidate, evidence entity.CandidateEvidence) (entity.PlanetPhysics, entity.HabitabilityAssessment) {
	result := entity.PlanetPhysics{
		PlanetCandidateID:       candidateID(candidate, evidence),
		ModelVersion:            modelVersion,
		BondAlbedoAssumption:    bondAlbedo,
		HZClassification:        "unknown",
		ConservativeHZInnerFlux: 1.06,
		ConservativeHZOuterFlux: 0.36,
		OptimisticHZInnerFlux:   1.78,
		OptimisticHZOuterFlux:   0.32,
		Warnings:                []string{},
	}

	available := 0.0
	const expected = 5.0 // period, depth, stellar radius, mass, temperature

	if evidence.BLSAvailable && finitePositive(evidence.BLSPeriod) {
		result.OrbitalPeriodDays = ptr(evidence.BLSPeriod)
		available++
	} else {
		result.Warnings = append(result.Warnings, "orbital_period_missing")
	}
	if evidence.BLSAvailable && evidence.BLSDepth > 0 && evidence.BLSDepth < 1 && isFinite(evidence.BLSDepth) {
		result.TransitDepthFraction = ptr(evidence.BLSDepth)
		available++
	} else {
		result.Warnings = append(result.Warnings, "transit_depth_missing_or_invalid")
	}
	if finitePositive(evidence.StellarRadius) {
		available++
	} else {
		result.Warnings = append(result.Warnings, "stellar_radius_missing")
	}
	if finitePositive(evidence.StellarMass) {
		available++
	} else {
		result.Warnings = append(result.Warnings, "stellar_mass_missing")
	}
	if finitePositive(evidence.Teff) {
		available++
		if evidence.Teff < 4000 || evidence.Teff > 7000 {
			result.Warnings = append(result.Warnings, "stellar_temperature_outside_solar_baseline_range")
		}
	} else {
		result.Warnings = append(result.Warnings, "stellar_temperature_missing")
	}

	result.Completeness = available / expected

	if result.TransitDepthFraction != nil && finitePositive(evidence.StellarRadius) {
		result.PlanetRadiusEarth = ptr(math.Sqrt(*result.TransitDepthFraction) * evidence.StellarRadius * earthsPerSun)
	}
	if result.OrbitalPeriodDays != nil && finitePositive(evidence.StellarMass) {
		periodYears := *result.OrbitalPeriodDays / 365.25
		result.SemiMajorAxisAU = ptr(math.Cbrt(evidence.StellarMass * periodYears * periodYears))
	}
	if finitePositive(evidence.StellarRadius) && finitePositive(evidence.Teff) {
		result.StellarLuminositySolar = ptr(evidence.StellarRadius * evidence.StellarRadius * math.Pow(evidence.Teff/solarTeffK, 4))
	}
	if result.StellarLuminositySolar != nil && result.SemiMajorAxisAU != nil && *result.SemiMajorAxisAU > 0 {
		result.InsolationEarth = ptr(*result.StellarLuminositySolar / (*result.SemiMajorAxisAU * *result.SemiMajorAxisAU))
		result.EquilibriumTemperatureK = ptr(evidence.Teff * math.Sqrt((evidence.StellarRadius*solarRadiusAU)/(2**result.SemiMajorAxisAU)) * math.Pow(1-bondAlbedo, 0.25))
		result.HZClassification = classifyHZ(*result.InsolationEarth)
	}

	return result, assess(result, evidence)
}

func assess(p entity.PlanetPhysics, evidence entity.CandidateEvidence) entity.HabitabilityAssessment {
	assessment := entity.HabitabilityAssessment{
		AssessmentVersion: assessmentVersion,
		Status:            "insufficient_data",
		Confidence:        p.Completeness,
		Tier:              "not_assessed",
		Components:        []entity.HabitabilityComponent{},
		MLStatus:          "not_evaluated",
		Disclaimer:        "Physics-based prioritization only; it is not evidence of life or confirmed habitability.",
	}

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

	rocky := component("rocky_likelihood", "Rocky-size likelihood", 20)
	if p.PlanetRadiusEarth != nil {
		rocky.Available = true
		r := *p.PlanetRadiusEarth
		switch {
		case r <= 1.6:
			rocky.Score, rocky.Reason = 20, "Radius is compatible with a predominantly rocky planet."
		case r <= 2.5:
			rocky.Score, rocky.Reason = 10, "Radius is in the super-Earth/sub-Neptune transition region."
		default:
			rocky.Score, rocky.Reason = 2, "Radius favors a volatile-rich or giant planet."
		}
	} else {
		rocky.Reason = "Requires transit depth and stellar radius."
	}

	thermal := component("equilibrium_temperature", "Equilibrium temperature", 15)
	if p.EquilibriumTemperatureK != nil {
		thermal.Available = true
		t := *p.EquilibriumTemperatureK
		switch {
		case t >= 200 && t <= 320:
			thermal.Score, thermal.Reason = 15, "Estimated equilibrium temperature is in the temperate screening band."
		case t >= 150 && t <= 380:
			thermal.Score, thermal.Reason = 8, "Estimated temperature is near the temperate screening band."
		default:
			thermal.Score, thermal.Reason = 1, "Estimated temperature is outside the temperate screening band."
		}
	} else {
		thermal.Reason = "Requires stellar and orbital estimates."
	}

	stellar := component("stellar_environment", "Stellar environment", 15)
	if finitePositive(evidence.Teff) {
		stellar.Available = true
		switch {
		case evidence.Teff >= 4000 && evidence.Teff <= 6500:
			stellar.Score, stellar.Reason = 15, "Host temperature is within the baseline model's best-supported band."
		case evidence.Teff >= 3000 && evidence.Teff <= 7500:
			stellar.Score, stellar.Reason = 8, "Host temperature needs activity and atmosphere follow-up."
		default:
			stellar.Score, stellar.Reason = 3, "Host temperature is outside the preferred screening band."
		}
	} else {
		stellar.Reason = "Host-star temperature is missing."
	}

	quality := component("data_quality", "Input completeness", 10)
	quality.Available = true
	quality.Score = math.Round(p.Completeness*quality.MaxScore*10) / 10
	quality.Reason = fmt.Sprintf("%.0f%% of required physical inputs are present.", p.Completeness*100)

	assessment.Components = []entity.HabitabilityComponent{zone, rocky, thermal, stellar, quality}
	if !zone.Available || !rocky.Available {
		return assessment
	}
	total := 0.0
	for _, c := range assessment.Components {
		total += c.Score
	}
	total = math.Max(0, math.Min(100, total))
	assessment.PhysicsScore = ptr(math.Round(total*10) / 10)
	assessment.Status = "evaluated"
	switch {
	case total >= 75:
		assessment.Tier = "high_priority"
	case total >= 50:
		assessment.Tier = "promising"
	case total >= 25:
		assessment.Tier = "low_priority"
	default:
		assessment.Tier = "unlikely"
	}
	return assessment
}

func component(key, label string, max float64) entity.HabitabilityComponent {
	return entity.HabitabilityComponent{Key: key, Label: label, MaxScore: max}
}

func classifyHZ(flux float64) string {
	if flux >= 0.36 && flux <= 1.06 {
		return "conservative"
	}
	if flux >= 0.32 && flux <= 1.78 {
		return "optimistic"
	}
	return "outside"
}

func candidateID(c entity.Candidate, e entity.CandidateEvidence) string {
	seed := fmt.Sprintf("tic:%d|sector:%d|source:%s|period:%.12g|epoch:%.12g|duration:%.12g|v1", c.TICID, c.Sector, c.SourceProductID, e.BLSPeriod, e.BLSTransitTime, e.BLSDuration)
	sum := sha256.Sum256([]byte(seed))
	return "pc_" + hex.EncodeToString(sum[:12])
}

func isFinite(value float64) bool       { return !math.IsNaN(value) && !math.IsInf(value, 0) }
func finitePositive(value float64) bool { return isFinite(value) && value > 0 }
func ptr(value float64) *float64        { return &value }
