package entity

type Lightcurve struct {
	TICID  int64
	Sector int
	Time   []float64
	Flux   []float64
}
