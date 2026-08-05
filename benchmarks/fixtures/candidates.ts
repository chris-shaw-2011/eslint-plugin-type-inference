const values = Array.from({ length: 100 }, (_, index) => index)

function sum() {
	return values.reduce((total, value) => total + value, 0)
}

void sum
export {}
