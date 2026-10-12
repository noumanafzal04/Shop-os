<?php

namespace App\Support;

/**
 * THE MONEY A SHOP TRADES IN.
 *
 * A shop had a currency SYMBOL it could not choose ("Rs", stored as a loose
 * string of up to five characters) and a currency code nothing read. So the
 * product spoke rupees to everybody: a shop in Delhi or in Dallas rang its
 * sales under "Rs", counted its drawer in five-thousand-rupee notes, and had
 * its lakhs printed with a comma every three digits.
 *
 * One currency per shop, chosen from this list. The CODE is what is stored;
 * everything else about it — the mark, where the commas go, whether a whole
 * amount is written with ".00", what is physically in a drawer — is read from
 * here, so the mark can never disagree with the code it stands for.
 *
 * No amount is ever converted. A currency says what the numbers MEAN; it does
 * not change them — which is why a shop with money already on its books may
 * not change it (see Tenant::hasMoneyOnItsBooks()).
 *
 * The panel holds a mirror of the formatting only (common/format/currency.ts),
 * and `CurrencyFormatFixturesTest` holds the two to the same strings.
 */
final class Currencies
{
    public const DEFAULT = 'PKR';

    /** A comma every three digits: 1,234,567. */
    public const WESTERN = 'western';

    /** Three, then twos — lakh and crore: 12,34,567. */
    public const INDIAN = 'indian';

    /**
     * `decimals`: `when_needed` writes a whole amount with no decimal point
     * (the way rupees are spoken and written day to day) and anything else
     * with two; `always` writes two every time.
     *
     * `space`: a mark made of letters stands apart from its number ("Rs 500",
     * "AED 500.00"); a sign is written against it ("$500.00", "₹500").
     *
     * `cash`: what is physically counted out of a drawer, largest first —
     * notes, then the coins a shop still gives as change.
     *
     * @var array<string, array{name: string, symbol: string, grouping: string, decimals: string, space: bool, cash: list<int|float>}>
     */
    private const LIST = [
        'PKR' => [
            'name' => 'Pakistani Rupee', 'symbol' => 'Rs', 'grouping' => self::WESTERN, 'decimals' => 'when_needed', 'space' => true,
            'cash' => [5000, 1000, 500, 100, 50, 20, 10, 5, 2, 1],
        ],
        'INR' => [
            'name' => 'Indian Rupee', 'symbol' => '₹', 'grouping' => self::INDIAN, 'decimals' => 'when_needed', 'space' => false,
            'cash' => [500, 200, 100, 50, 20, 10, 5, 2, 1],
        ],
        'USD' => [
            'name' => 'US Dollar', 'symbol' => '$', 'grouping' => self::WESTERN, 'decimals' => 'always', 'space' => false,
            'cash' => [100, 50, 20, 10, 5, 2, 1, 0.25, 0.1, 0.05, 0.01],
        ],
        'AED' => [
            'name' => 'UAE Dirham', 'symbol' => 'AED', 'grouping' => self::WESTERN, 'decimals' => 'always', 'space' => true,
            'cash' => [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.5, 0.25],
        ],
        'SAR' => [
            'name' => 'Saudi Riyal', 'symbol' => 'SAR', 'grouping' => self::WESTERN, 'decimals' => 'always', 'space' => true,
            'cash' => [500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05],
        ],
        'GBP' => [
            'name' => 'Pound Sterling', 'symbol' => '£', 'grouping' => self::WESTERN, 'decimals' => 'always', 'space' => false,
            'cash' => [50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01],
        ],
        'EUR' => [
            'name' => 'Euro', 'symbol' => '€', 'grouping' => self::WESTERN, 'decimals' => 'always', 'space' => false,
            'cash' => [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01],
        ],
        'BDT' => [
            'name' => 'Bangladeshi Taka', 'symbol' => '৳', 'grouping' => self::INDIAN, 'decimals' => 'when_needed', 'space' => false,
            'cash' => [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1],
        ],
    ];

    /** @return list<string> */
    public static function codes(): array
    {
        return array_keys(self::LIST);
    }

    public static function known(mixed $code): bool
    {
        return is_string($code) && isset(self::LIST[strtoupper($code)]);
    }

    /**
     * The code a shop is ON. Anything this list does not hold — a setting
     * saved before the list existed, a typo through an old client — is the
     * default, said plainly, rather than a mark nobody can account for.
     */
    public static function code(mixed $code): string
    {
        return self::known($code) ? strtoupper((string) $code) : self::DEFAULT;
    }

    public static function symbol(mixed $code): string
    {
        return self::LIST[self::code($code)]['symbol'];
    }

    /**
     * What a screen needs to write this currency's amounts for itself.
     *
     * `cash` rides with it: a till that has lost its connection still has to
     * count its drawer, in this currency's notes and coins.
     *
     * @return array{code: string, name: string, symbol: string, grouping: string, decimals: string, space: bool, cash: list<int|float>}
     */
    public static function describe(mixed $code): array
    {
        $code = self::code($code);
        $c = self::LIST[$code];

        return [
            'code' => $code,
            'name' => $c['name'],
            'symbol' => $c['symbol'],
            'grouping' => $c['grouping'],
            'decimals' => $c['decimals'],
            'space' => $c['space'],
            'cash' => $c['cash'],
        ];
    }

    /**
     * Every currency a shop may choose, in the order the list is kept.
     *
     * @return list<array{code: string, name: string, symbol: string, grouping: string, decimals: string, space: bool, cash: list<int|float>}>
     */
    public static function options(): array
    {
        return array_map(self::describe(...), self::codes());
    }

    /**
     * What is counted out of a drawer in this currency, largest first.
     *
     * @return list<int|float>
     */
    public static function cash(mixed $code): array
    {
        return self::LIST[self::code($code)]['cash'];
    }

    /**
     * The digits of an amount, grouped the way this currency's country writes
     * them. `$places` null follows the currency: no decimal point on a whole
     * amount where that is how it is written, two otherwise.
     */
    public static function number(float|int|string|null $amount, mixed $code = null, ?int $places = null): string
    {
        $c = self::LIST[self::code($code)];
        // Rounded FIRST: 0.005 is two decimal places' worth of money, and
        // asking whether the raw value has a fraction puts ".00" on 4000.0000001.
        $rounded = round((float) $amount, 2);
        $places ??= ($c['decimals'] === 'always' || floor($rounded) !== $rounded) ? 2 : 0;

        $fixed = number_format(abs($rounded), $places, '.', '');
        [$whole, $fraction] = array_pad(explode('.', $fixed, 2), 2, null);

        $grouped = $c['grouping'] === self::INDIAN ? self::lakhs($whole) : number_format((float) $whole, 0, '.', ',');
        $sign = $rounded < 0 && (float) $fixed > 0 ? '-' : '';

        return $sign.$grouped.($fraction !== null ? '.'.$fraction : '');
    }

    /**
     * An amount as a person reads it on a screen, in a message, in a text:
     * "Rs 4,000", "Rs 2,350,196.50", "₹12,34,567", "$4,000.00".
     */
    public static function format(float|int|string|null $amount, mixed $code = null, ?int $places = null): string
    {
        $c = self::LIST[self::code($code)];
        $number = self::number($amount, $code, $places);

        // A mark of letters stands apart and the sign stays on the number
        // ("Rs -500"); a sign is written against the number, minus first ("-$5.00").
        if ($c['space']) {
            return $c['symbol'].' '.$number;
        }

        return str_starts_with($number, '-')
            ? '-'.$c['symbol'].substr($number, 1)
            : $c['symbol'].$number;
    }

    /** An amount on PAPER — a receipt, a bill, a Z-read: always to the paisa. */
    public static function paper(float|int|string|null $amount, mixed $code = null): string
    {
        return self::format($amount, $code, 2);
    }

    /** 1234567 → 12,34,567: the last three, then twos. */
    private static function lakhs(string $digits): string
    {
        if (strlen($digits) <= 3) {
            return $digits;
        }

        $head = substr($digits, 0, -3);
        $tail = substr($digits, -3);

        return ltrim(implode(',', str_split(str_pad($head, (int) (ceil(strlen($head) / 2) * 2), ' ', STR_PAD_LEFT), 2)), ' ').','.$tail;
    }
}
