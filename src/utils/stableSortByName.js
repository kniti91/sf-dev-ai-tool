export default function stableSortByName(arr = []) {

    if (!Array.isArray(arr)) return [];

    return [...arr].sort((a, b) =>
        (a?.name ?? '').localeCompare(
            (b?.name ?? ''),
            undefined,
            { sensitivity: 'base' } // case-insensitive
        )
    );
}
