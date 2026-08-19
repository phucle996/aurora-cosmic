package physics

import (
	"math"
	"testing"

	"go-api/internal/domain/entity"
)

func TestDeriveCandidateEarthLikeSignal(t *testing.T) {
	candidate := entity.Candidate{TICID: 1, Sector: 42, SourceProductID: "test-source"}
	evidence := entity.CandidateEvidence{
		BLSAvailable:   true,
		BLSPeriod:      365.25,
		BLSDepth:       math.Pow(1/earthsPerSun, 2),
		BLSDuration:    0.5,
		BLSTransitTime: 100,
		Teff:           solarTeffK,
		StellarRadius:  1,
		StellarMass:    1,
	}

	physics, assessment := DeriveCandidate(candidate, evidence)
	assertNear(t, physics.PlanetRadiusEarth, 1, 0.01)
	assertNear(t, physics.SemiMajorAxisAU, 1, 0.01)
	assertNear(t, physics.InsolationEarth, 1, 0.01)
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

func TestDeriveCandidateDoesNotImputeMissingCatalogData(t *testing.T) {
	physics, assessment := DeriveCandidate(
		entity.Candidate{TICID: 2, Sector: 10},
		entity.CandidateEvidence{BLSAvailable: true, BLSPeriod: 8, BLSDepth: 0.001},
	)
	if physics.SemiMajorAxisAU != nil || physics.PlanetRadiusEarth != nil || physics.InsolationEarth != nil {
		t.Fatal("derived fields must remain null when stellar inputs are absent")
	}
	if assessment.PhysicsScore != nil || assessment.Status != "insufficient_data" {
		t.Fatalf("expected insufficient-data assessment, got %#v", assessment)
	}
}

func TestPlanetCandidateIDIsStableAndSignalSpecific(t *testing.T) {
	c := entity.Candidate{TICID: 7, Sector: 3, SourceProductID: "source"}
	e := entity.CandidateEvidence{BLSPeriod: 12, BLSTransitTime: 2, BLSDuration: 0.2}
	p1, _ := DeriveCandidate(c, e)
	p2, _ := DeriveCandidate(c, e)
	if p1.PlanetCandidateID != p2.PlanetCandidateID {
		t.Fatal("same signal must produce the same identity")
	}
	e.BLSPeriod = 13
	p3, _ := DeriveCandidate(c, e)
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
