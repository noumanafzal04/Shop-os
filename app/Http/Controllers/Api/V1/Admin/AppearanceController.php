<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Support\ApiResponse;
use App\Support\PlatformSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * HOW THE CONSOLE LOOKS — and that it can be changed.
 *
 * A shop has had Appearance since the first week: its own colour, how far
 * that colour reaches into the surfaces, and what its menu is painted in. The
 * platform console had none. It was drawn from a fallback — the house colour,
 * the menu in it — and whoever ran the platform could dress every shop on it
 * and not their own screen.
 *
 * ── Whose it is ──────────────────────────────────────────────────────
 *
 * The PLATFORM's, not a person's. One look, saved once, worn by everybody
 * who works on the console — exactly as a shop's is worn by everybody who
 * works at the shop. Light or dark is the personal one, and stays on the
 * device.
 *
 * So everybody on the console may READ it — the screen has to be painted for
 * the person who schedules banner ads too — and only a super admin may change
 * it. No permission grants that: there is no "may repaint the console" worth
 * handing to one member of staff and not another.
 */
class AppearanceController extends Controller
{
    public function show(): JsonResponse
    {
        return ApiResponse::ok($this->appearance());
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate(PlatformSettings::appearanceRules());

        PlatformSettings::put([
            'console_theme_tint' => $data['console_theme_tint'],
            'console_theme_sidebar' => $data['console_theme_sidebar'],
        ], $request->user()->id);

        // "No colour of its own" is the ABSENCE of one, not a stored copy of
        // today's house colour — so a console that never chose follows the
        // product when the product's colour changes.
        if ($data['console_theme_primary'] === null) {
            PlatformSettings::forget(['console_theme_primary']);
        } else {
            // Lower case, so "the same colour" is the same string wherever it
            // is compared — the canvas marks a preset as chosen by equality.
            PlatformSettings::put(['console_theme_primary' => strtolower($data['console_theme_primary'])], $request->user()->id);
        }

        return ApiResponse::ok($this->appearance(), 'Appearance saved for everyone on the console');
    }

    /** @return array{console_theme_primary: string|null, console_theme_tint: string, console_theme_sidebar: string} */
    private function appearance(): array
    {
        $all = PlatformSettings::all();

        return [
            'console_theme_primary' => $all['console_theme_primary'],
            'console_theme_tint' => $all['console_theme_tint'],
            'console_theme_sidebar' => $all['console_theme_sidebar'],
        ];
    }
}
