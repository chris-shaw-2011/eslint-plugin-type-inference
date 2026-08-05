interface Row {
	value: string
}

function mapRow(row: Row): Row {
	return row
}

export const database = {
	row: mapRow({ value: "ok" }),
}
