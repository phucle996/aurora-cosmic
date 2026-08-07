package main

import (
	"fmt"
	"os"

	"github.com/aurora-cosmic/go-api/internal/app"
)

func main() {
	fmt.Println("[aurora-api] Service skeleton initialized.")
	if err := app.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
