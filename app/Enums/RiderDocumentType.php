<?php

namespace App\Enums;

/**
 * The papers a rider is asked for.
 *
 * `required()` is the list that gates submission, and it depends on the
 * vehicle: a cyclist has no licence and no registration book, so demanding
 * them would be a form nobody can finish.
 */
enum RiderDocumentType: string
{
    case CnicFront = 'cnic_front';
    case CnicBack = 'cnic_back';
    case Licence = 'licence';
    case VehicleRegistration = 'vehicle_registration';
    case Selfie = 'selfie';

    /** @return self[] */
    public static function requiredFor(string $vehicleType): array
    {
        $base = [self::CnicFront, self::CnicBack, self::Selfie];

        return $vehicleType === 'cycle' ? $base : [...$base, self::Licence];
    }

    public function label(): string
    {
        return match ($this) {
            self::CnicFront => 'CNIC — front',
            self::CnicBack => 'CNIC — back',
            self::Licence => 'Driving licence',
            self::VehicleRegistration => 'Vehicle registration',
            self::Selfie => 'Photo of you',
        };
    }
}
