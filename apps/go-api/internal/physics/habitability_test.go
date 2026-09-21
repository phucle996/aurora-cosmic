package physics

import (
	"math"
	"testing"

	"go-api/internal/domain/entity"
)

func TestDeriveTargetPhysicsEarthLikeSignal(t *testing.T) {
	evidence := entity.TargetEvidence{
		BLSAvailable:   true,
		BLSPeriod:      365.25,
		BLSDepth:       math.Pow(1/earthsPerSun, 2),
		BLSDuration:    0.5,
		BLSTransitTime: 100,
		Teff:           solarTeffK,
		StellarRadius:  1,
		StellarMass:    1,
	}

	physics, assessment := DeriveTargetPhysics(1, 42, evidence)
	assertNear(t, physics.PlanetRadiusEarth, 1, 0.01)
	assertNear(t, physics.SemiMajorAxisAU, 1, 0.01)
	assertNear(t, physics.InsolationEarth, 1, 0.01)
	if physics.PlanetClassification != "Earth-size" {
		t.Fatalf("expected Earth-size classification, got %q", physics.PlanetClassification)
	}
	if physics.TransitDurationHours == nil || *physics.TransitDurationHours != 12.0 {
		t.Fatalf("expected 12.0 transit hours, got %#v", physics.TransitDurationHours)
	}
	if physics.HZClassification != "conservative" {
		t.Fatalf("expected conservative HZ, got %q", physics.HZClassification)
	}
	if assessment.PhysicsScore == nil || *assessment.PhysicsScore < 75 {
		t.Fatalf("expected high physics score, got %#v", assessment.PhysicsScore)
	}
	if assessment.MLScore != nil || assessment.MLStatus != "not_evaluated" {
		t.Fatal("ML result must stay null until an evaluated model produces it")
	}
}

func TestDeriveTargetPhysicsDoesNotImputeMissingCatalogData(t *testing.T) {
	physics, assessment := DeriveTargetPhysics(
		2,
		10,
		entity.TargetEvidence{BLSAvailable: true, BLSPeriod: 8, BLSDepth: 0.001},
	)
	if physics.SemiMajorAxisAU != nil || physics.PlanetRadiusEarth != nil || physics.InsolationEarth != nil {
		t.Fatal("derived fields must remain null when stellar inputs are absent")
	}
	if assessment.PhysicsScore != nil || assessment.Status != "insufficient_data" {
		t.Fatalf("expected insufficient-data assessment, got %#v", assessment)
	}
}

func TestPlanetCandidateIDIsStableAndSignalSpecific(t *testing.T) {
	e := entity.TargetEvidence{BLSPeriod: 12, BLSTransitTime: 2, BLSDuration: 0.2}
	p1, _ := DeriveTargetPhysics(7, 3, e)
	p2, _ := DeriveTargetPhysics(7, 3, e)
	if p1.PlanetCandidateID != p2.PlanetCandidateID {
		t.Fatal("same signal must produce the same identity")
	}
	e.BLSPeriod = 13
	p3, _ := DeriveTargetPhysics(7, 3, e)
	if p1.PlanetCandidateID == p3.PlanetCandidateID {
		t.Fatal("different signals must not share an identity")
	}
}

func assertNear(t *testing.T, value *float64, want, tolerance float64) {
	t.Helper()
	if value == nil || math.Abs(*value-want) > tolerance {
		t.Fatalf("got %#v, want %.4f ± %.4f", value, want, tolerance)
	}
}
