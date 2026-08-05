import { database } from "./first.js"

function useString(value: string) {
	return value.toUpperCase()
}

const normalized = useString(database.row.value)

void normalized
