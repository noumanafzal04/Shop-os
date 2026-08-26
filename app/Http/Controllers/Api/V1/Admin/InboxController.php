<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Models\Enquiry;
use App\Models\ShopRequest;
use App\Support\ApiResponse;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * HOW MANY PEOPLE ARE WAITING, for the rail to say so.
 *
 * Two queues on this platform hold a person rather than a record: a demo shop
 * asking to become a business, and a stranger asking to be shown around.
 * Neither of them nags. Both screens sort oldest-first precisely because a slow
 * reply costs the customer nothing — which means the ONLY thing that gets them
 * answered is somebody choosing to open the screen, and nothing on any other
 * screen ever suggested they should.
 *
 * So the number moves to where the admin already is. A badge on the rail is the
 * whole feature; this endpoint is deliberately two counts and nothing else, so
 * it can be polled cheaply beside every other screen without pulling a page of
 * rows nobody asked for.
 *
 * ── A count that is withheld is ABSENT, never zero ─────────────────────
 *
 * Platform staff hold explicit permission lists — the person who schedules
 * banner ads is not the person who opens shops. A zero for somebody who may not
 * read the queue is a lie in the shape of an answer ("nobody is waiting"), and
 * it would draw no badge, which is indistinguishable from the truth right up
 * until they are asked why they never replied. An absent key draws nothing and
 * claims nothing.
 */
class InboxController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        // Both queues sit behind the same gate as the screens that show them:
        // whoever may open a shop is whoever answers the people asking for one.
        if (! $user->hasPermission(Permissions::TENANTS_CREATE)) {
            return ApiResponse::ok([]);
        }

        return ApiResponse::ok([
            'shop_requests' => ShopRequest::query()->pending()->count(),
            // NEW only, not `open()`. A "contacted" enquiry is somebody else's
            // half-finished conversation, and counting it would leave a badge
            // sitting on the rail that nobody can clear by doing their job.
            'enquiries' => Enquiry::query()->where('status', Enquiry::NEW)->count(),
        ]);
    }
}
