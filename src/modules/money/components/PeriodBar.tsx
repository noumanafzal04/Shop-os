/**
 * STUB — structure only.
 *
 * Today · This week · This month · This year · Tax year · Custom.
 *
 * The same names and the same boundaries the server uses, because they are
 * the server's periods. "This month" is the CALENDAR month — a rule this
 * codebase has already had to write down after a month-to-date figure
 * disagreed with a calendar one.
 *
 * Dates are rendered in the SHOP's timezone. `toISOString().slice(0,10)`
 * is yesterday before 05:00 in Karachi, and that has bitten this product
 * before.
 */
