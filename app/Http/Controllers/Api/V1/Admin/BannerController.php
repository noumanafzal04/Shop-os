<?php

namespace App\Http\Controllers\Api\V1\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\BannerRequest;
use App\Models\Banner;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Storage;

class BannerController extends Controller
{
    public function index(): JsonResponse
    {
        return ApiResponse::ok(
            Banner::query()->with('advertiser:id,business_name,slug')->orderBy('sort_order')->latest()->get(),
        );
    }

    public function store(BannerRequest $request): JsonResponse
    {
        $data = $request->validated();
        $data['image_path'] = $request->file('image')->store('banners', 'public');
        unset($data['image']);

        $banner = Banner::query()->create($data);

        return ApiResponse::created($banner->load('advertiser:id,business_name,slug'), 'Banner created');
    }

    public function update(BannerRequest $request, string $id): JsonResponse
    {
        /** @var Banner $banner */
        $banner = Banner::query()->findOrFail($id);
        $data = $request->validated();

        if ($request->hasFile('image')) {
            Storage::disk('public')->delete($banner->image_path);
            $data['image_path'] = $request->file('image')->store('banners', 'public');
        }
        unset($data['image']);

        $banner->update($data);

        return ApiResponse::ok($banner->load('advertiser:id,business_name,slug'), 'Banner updated');
    }

    public function destroy(string $id): JsonResponse
    {
        /** @var Banner $banner */
        $banner = Banner::query()->findOrFail($id);
        Storage::disk('public')->delete($banner->image_path);
        $banner->delete();

        return ApiResponse::noContent('Banner deleted');
    }
}
