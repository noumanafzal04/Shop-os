<?php

namespace App\Actions\Restaurant;

use App\Exceptions\DomainException;
use App\Models\KitchenTicket;
use App\Models\Product;
use App\Models\RestaurantTicket;
use App\Models\RestaurantTicketItem;
use App\Support\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * "Send to kitchen": fire the tab's pending (or a chosen subset of) items as
 * Kitchen Order Tickets (KOTs). Fired items are stamped with their KOT id and
 * flip to kot_status = fired so a later fire only sends the newly-added items.
 *
 * One fire produces one KOT PER STATION, because a section only ever wants the
 * items it cooks: the bar must not be handed the biryani ticket, and a grill
 * ticket carrying drinks is a plate that goes out late. A shop that configured
 * no stations is a single-printer kitchen — it keeps getting exactly one KOT.
 */
class FireKitchenTicketAction
{
    public function __construct(private readonly TenantContext $context)
    {
    }

    /**
     * @return Collection<int, KitchenTicket> the KOTs created by this fire, one per station
     */
    public function execute(RestaurantTicket $ticket, array $data = []): Collection
    {
        if (! $ticket->isOpen()) {
            throw DomainException::conflict('This tab is closed.', 'TICKET_NOT_OPEN');
        }

        $tenantId = $this->context->id();
        $stations = $this->configuredStations();

        return DB::transaction(function () use ($ticket, $data, $tenantId, $stations): Collection {
            $query = $ticket->items()
                ->whereNull('voided_at')
                ->where('kot_status', 'pending')
                ->lockForUpdate();

            if (! empty($data['item_ids'])) {
                $query->whereIn('id', $data['item_ids']);
            }

            $items = $query->get();

            if ($items->isEmpty()) {
                throw DomainException::unprocessable(
                    'Nothing new to send — all items have already been fired to the kitchen.',
                    'NOTHING_TO_FIRE',
                );
            }

            // Numbering continues the tab's own sequence and keeps climbing
            // across the KOTs of this one fire, so no two collide on #.
            $kotNumber = (int) $ticket->kitchenTickets()->count();

            $kots = collect();

            foreach ($this->route($items, $stations, $data['station'] ?? null) as $group) {
                /** @var KitchenTicket $kot */
                $kot = KitchenTicket::query()->create([
                    'tenant_id' => $tenantId,
                    'ticket_id' => $ticket->id,
                    'kot_number' => ++$kotNumber,
                    'station' => $group['station'],
                    'status' => 'fired',
                    'notes' => $data['notes'] ?? null,
                    'fired_at' => now(),
                    'fired_by' => auth()->id(),
                ]);

                foreach ($group['items'] as $item) {
                    $item->update([
                        'kitchen_ticket_id' => $kot->id,
                        'kot_status' => 'fired',
                    ]);
                }

                $kots->push($kot->load('items'));
            }

            return $kots;
        });
    }

    /**
     * The stations this shop actually runs, in the order the owner listed them
     * (that order decides which section's KOT prints first). Blanks and repeats
     * are dropped — a section listed twice is still one section, and would
     * otherwise be handed two KOTs for the same food.
     *
     * @return array<int, string>
     */
    private function configuredStations(): array
    {
        $configured = $this->context->get()?->setting('kitchen_stations', []) ?? [];

        return array_values(array_unique(array_filter(
            array_map(fn ($s) => trim((string) $s), (array) $configured),
            fn (string $s) => $s !== '',
        )));
    }

    /**
     * Split the fired items into one group per station.
     *
     * An item whose product names no station — or names one this shop no longer
     * runs — falls back to the first configured station rather than vanishing:
     * a ticket printing in the wrong section gets walked over, a ticket that
     * printed nowhere is a dish nobody ever cooks.
     *
     * @param  Collection<int, RestaurantTicketItem>  $items
     * @param  array<int, string>  $stations
     * @return array<int, array{station: ?string, items: Collection<int, RestaurantTicketItem>}>
     */
    private function route(Collection $items, array $stations, ?string $forced): array
    {
        $forced = trim((string) $forced);

        // A manager re-firing at a named printer overrides routing outright, as
        // does having no stations at all (station null = the one KOT, as ever).
        if ($forced !== '' || $stations === []) {
            return [['station' => $forced !== '' ? $forced : null, 'items' => $items]];
        }

        // Menu items may be long deleted and still be sitting on an open tab.
        $productStations = Product::withTrashed()
            ->whereIn('id', $items->pluck('product_id')->unique()->all())
            ->pluck('kitchen_station', 'id');

        // Match on a case-folded name but keep the owner's spelling on the KOT:
        // "bar" typed on a product is the same section as "Bar" in settings.
        $canonical = [];
        foreach ($stations as $station) {
            $canonical[mb_strtolower($station)] = $station;
        }

        $fallback = $stations[0];
        $grouped = [];

        foreach ($items as $item) {
            $named = mb_strtolower(trim((string) $productStations->get($item->product_id)));
            $station = $canonical[$named] ?? $fallback;
            $grouped[$station] ??= collect();
            $grouped[$station]->push($item);
        }

        // Emit in configured order so a section's KOT number is stable per fire.
        return collect($stations)
            ->filter(fn (string $s) => isset($grouped[$s]))
            ->map(fn (string $s) => ['station' => $s, 'items' => $grouped[$s]])
            ->values()
            ->all();
    }
}
