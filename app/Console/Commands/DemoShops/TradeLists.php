<?php

namespace App\Console\Commands\DemoShops;

use App\Console\Commands\SeedDemoShops;

/**
 * What the other demo shops sell — a chemist, a clothing shop, a workshop, a
 * forecourt's shop, a repair centre and an online gadget store.
 *
 * Each list is in the words that trade uses on its own shelf labels, because
 * the point of a demo is that the person looking at it recognises their shop.
 * Every method returns the same shape: one line per thing that can be sold.
 *
 * @see SeedDemoShops
 *
 * @phpstan-type Line array{category: string, name: string, price: int, brand: ?string, generic?: ?string, by_weight: bool}
 */
final class TradeLists
{
    /** @return array<int, Line> */
    public static function pharmacy(): array
    {
        // [brand, salt, [what is in the box => rupees]]
        $shelves = [
            'Pain & Fever' => [
                ['Panadol', 'Paracetamol', ['500 mg Tablets (10)' => 35, '500 mg Tablets (200)' => 620, 'Extra Tablets (10)' => 50, 'CF Tablets (10)' => 60]],
                ['Calpol', 'Paracetamol', ['Syrup 60 ml' => 95, 'Syrup 120 ml' => 160, '6 Plus Syrup 90 ml' => 150]],
                ['Brufen', 'Ibuprofen', ['200 mg Tablets (30)' => 140, '400 mg Tablets (30)' => 210, '600 mg Tablets (30)' => 290, 'Syrup 120 ml' => 150]],
                ['Ponstan', 'Mefenamic Acid', ['250 mg Capsules (20)' => 130, 'Forte 500 mg Tablets (20)' => 210, 'Suspension 60 ml' => 120]],
                ['Disprin', 'Aspirin', ['300 mg Tablets (12)' => 40]], ['Voltral', 'Diclofenac Sodium', ['50 mg Tablets (20)' => 260, 'SR 100 mg Tablets (10)' => 240, 'Emulgel 20 g' => 290]],
                ['Nuberol', 'Paracetamol + Orphenadrine', ['Forte Tablets (30)' => 390]], ['Synflex', 'Naproxen Sodium', ['550 mg Tablets (20)' => 420]],
                ['Arcoxia', 'Etoricoxib', ['60 mg Tablets (10)' => 520, '90 mg Tablets (10)' => 690]], ['Tonoflex', 'Tramadol', ['50 mg Capsules (10)' => 190]],
            ],
            'Antibiotics' => [
                ['Augmentin', 'Co-Amoxiclav', ['375 mg Tablets (6)' => 190, '625 mg Tablets (6)' => 320, '1 g Tablets (6)' => 420, 'Suspension 156 mg 90 ml' => 290, 'DS Suspension 312 mg 90 ml' => 420]],
                ['Amoxil', 'Amoxicillin', ['250 mg Capsules (20)' => 190, '500 mg Capsules (20)' => 340, 'Syrup 125 mg 90 ml' => 130, 'Forte Syrup 250 mg 90 ml' => 190]],
                ['Velosef', 'Cephradine', ['250 mg Capsules (12)' => 260, '500 mg Capsules (12)' => 460, 'Suspension 125 mg 90 ml' => 250]],
                ['Klaricid', 'Clarithromycin', ['250 mg Tablets (10)' => 560, '500 mg Tablets (10)' => 990, 'Suspension 125 mg 60 ml' => 590]],
                ['Azomax', 'Azithromycin', ['250 mg Capsules (6)' => 290, '500 mg Tablets (3)' => 320, 'Suspension 200 mg 15 ml' => 290]],
                ['Ciproxin', 'Ciprofloxacin', ['250 mg Tablets (10)' => 290, '500 mg Tablets (10)' => 490]], ['Novidat', 'Ciprofloxacin', ['250 mg Tablets (10)' => 250, '500 mg Tablets (10)' => 430]],
                ['Flagyl', 'Metronidazole', ['200 mg Tablets (20)' => 60, '400 mg Tablets (20)' => 100, 'Suspension 60 ml' => 80]],
                ['Cefspan', 'Cefixime', ['200 mg Capsules (5)' => 390, '400 mg Capsules (5)' => 620, 'Suspension 100 mg 30 ml' => 320]],
                ['Leflox', 'Levofloxacin', ['250 mg Tablets (10)' => 320, '500 mg Tablets (10)' => 540]], ['Septran', 'Co-Trimoxazole', ['Tablets (20)' => 90, 'DS Tablets (10)' => 110, 'Suspension 50 ml' => 80]],
                ['Vibramycin', 'Doxycycline', ['100 mg Capsules (8)' => 190]], ['Zithromax', 'Azithromycin', ['250 mg Capsules (6)' => 620]],
            ],
            'Stomach & Digestion' => [
                ['Risek', 'Omeprazole', ['20 mg Capsules (14)' => 290, '40 mg Capsules (14)' => 480]], ['Nexum', 'Esomeprazole', ['20 mg Capsules (14)' => 390, '40 mg Capsules (14)' => 620]],
                ['Zantac', 'Ranitidine', ['150 mg Tablets (20)' => 150]], ['Gaviscon', 'Sodium Alginate', ['Liquid 120 ml' => 320, 'Liquid 240 ml' => 560]],
                ['Mucaine', 'Antacid + Oxetacaine', ['Suspension 120 ml' => 220]], ['Motilium', 'Domperidone', ['10 mg Tablets (30)' => 290, 'Suspension 120 ml' => 260]],
                ['Imodium', 'Loperamide', ['2 mg Capsules (6)' => 120]], ['Peditral', 'Oral Rehydration Salts', ['Sachet' => 30, 'Sachets (20)' => 560]],
                ['Gravinate', 'Dimenhydrinate', ['50 mg Tablets (10)' => 50, 'Syrup 60 ml' => 90]], ['Colofac', 'Mebeverine', ['135 mg Tablets (30)' => 690]],
                ['Digas', 'Simethicone', ['Tablets (30)' => 190, 'Drops 20 ml' => 140]], ['Eno', 'Fruit Salt', ['Sachet' => 30, 'Bottle 100 g' => 320]],
                ['Qarshi Ispaghol', 'Ispaghol Husk', ['85 g' => 220, '140 g' => 340]], ['Duphalac', 'Lactulose', ['Syrup 120 ml' => 390]], ['Entamizole', 'Metronidazole + Diloxanide', ['Tablets (30)' => 320]],
            ],
            'Heart & Blood Pressure' => [
                ['Concor', 'Bisoprolol', ['2.5 mg Tablets (14)' => 190, '5 mg Tablets (14)' => 290, '10 mg Tablets (14)' => 420]],
                ['Tenormin', 'Atenolol', ['25 mg Tablets (14)' => 110, '50 mg Tablets (14)' => 160, '100 mg Tablets (14)' => 250]],
                ['Norvasc', 'Amlodipine', ['5 mg Tablets (20)' => 390, '10 mg Tablets (20)' => 620]], ['Lipiget', 'Atorvastatin', ['10 mg Tablets (10)' => 190, '20 mg Tablets (10)' => 320, '40 mg Tablets (10)' => 520]],
                ['Loprin', 'Aspirin', ['75 mg Tablets (30)' => 60, '150 mg Tablets (30)' => 90]], ['Ascard', 'Aspirin', ['75 mg Tablets (30)' => 55]],
                ['Zestril', 'Lisinopril', ['5 mg Tablets (28)' => 290, '10 mg Tablets (28)' => 460]], ['Cozaar', 'Losartan', ['50 mg Tablets (28)' => 890]],
                ['Co-Diovan', 'Valsartan + HCTZ', ['80/12.5 mg Tablets (28)' => 1190]], ['Lasix', 'Furosemide', ['40 mg Tablets (10)' => 40]],
                ['Plavix', 'Clopidogrel', ['75 mg Tablets (28)' => 1490]], ['Angised', 'Glyceryl Trinitrate', ['0.5 mg Tablets (100)' => 190]],
            ],
            'Diabetes' => [
                ['Glucophage', 'Metformin', ['250 mg Tablets (50)' => 120, '500 mg Tablets (50)' => 190, '850 mg Tablets (50)' => 290, '1 g Tablets (30)' => 320]],
                ['Getryl', 'Glimepiride', ['1 mg Tablets (20)' => 190, '2 mg Tablets (20)' => 320, '4 mg Tablets (20)' => 520]],
                ['Diamicron', 'Gliclazide', ['MR 60 mg Tablets (30)' => 690]], ['Januvia', 'Sitagliptin', ['50 mg Tablets (14)' => 1290, '100 mg Tablets (14)' => 1890]],
                ['Galvus Met', 'Vildagliptin + Metformin', ['50/500 mg Tablets (30)' => 1790, '50/1000 mg Tablets (30)' => 1890]],
                ['Humulin', 'Human Insulin', ['R 10 ml Vial' => 890, 'N 10 ml Vial' => 890, '70/30 10 ml Vial' => 890]], ['Mixtard', 'Human Insulin', ['30 10 ml Vial' => 920]],
                ['Lantus', 'Insulin Glargine', ['SoloStar Pen' => 3290]], ['Accu-Chek', 'Test Strips', ['Active Strips (50)' => 3490, 'Instant Strips (50)' => 3290]],
                ['Accu-Chek', 'Lancets', ['Softclix Lancets (100)' => 990]], ['BD Insulin Syringes', 'Insulin Syringe', ['1 ml (10)' => 290]],
            ],
            'Cough, Cold & Allergy' => [
                ['Arinac', 'Ibuprofen + Pseudoephedrine', ['Tablets (20)' => 150, 'Forte Tablets (20)' => 220]], ['Rigix', 'Cetirizine', ['10 mg Tablets (10)' => 90, 'Syrup 60 ml' => 110]],
                ['Softin', 'Loratadine', ['10 mg Tablets (10)' => 120, 'Syrup 60 ml' => 130]], ['Telfast', 'Fexofenadine', ['120 mg Tablets (10)' => 320, '180 mg Tablets (10)' => 460]],
                ['Avil', 'Pheniramine', ['25 mg Tablets (20)' => 60, 'Syrup 60 ml' => 70]], ['Hydryllin', 'Aminophylline + Diphenhydramine', ['Syrup 120 ml' => 130]],
                ['Pulmonol', 'Cough Syrup', ['Syrup 120 ml' => 140]], ['Acefyl', 'Acefylline Piperazine', ['Cough Syrup 120 ml' => 160]], ['Coferb', 'Herbal Cough Syrup', ['Syrup 120 ml' => 190]],
                ['Actifed', 'Triprolidine + Pseudoephedrine', ['Tablets (20)' => 150, 'DM Syrup 90 ml' => 170]], ['Ventolin', 'Salbutamol', ['Inhaler' => 390, '2 mg Tablets (20)' => 60, 'Syrup 60 ml' => 80]],
                ['Seretide', 'Salmeterol + Fluticasone', ['Evohaler 25/125' => 1890]], ['Clenil', 'Beclomethasone', ['Inhaler 250 mcg' => 990]], ['Otrivin', 'Xylometazoline', ['Nasal Drops 10 ml' => 190, 'Nasal Spray 10 ml' => 290]],
                ['Strepsils', 'Lozenges', ['Honey & Lemon (24)' => 290, 'Original (24)' => 290]], ['Vicks VapoRub', 'Menthol Rub', ['25 g' => 220, '50 g' => 390]], ['Johar Joshanda', 'Herbal Tea', ['Sachet' => 30, 'Sachets (30)' => 690]],
            ],
            'Vitamins & Supplements' => [
                ['Surbex', 'Multivitamin', ['Z Tablets (30)' => 390, 'T Tablets (30)' => 320]], ['Caltrate', 'Calcium + Vitamin D', ['600 Tablets (30)' => 890]],
                ['CaC-1000', 'Calcium + Vitamin C', ['Plus Orange (10)' => 290, 'Plus Lemon (10)' => 290, 'Plus Orange (20)' => 520]],
                ['Neurobion', 'Vitamin B Complex', ['Tablets (30)' => 320, 'Injection (3 ampoules)' => 390]], ['Sangobion', 'Iron + Folic Acid', ['Capsules (30)' => 420]],
                ['Iberet', 'Iron + Folic Acid', ['Folic 500 Tablets (30)' => 520]], ['Folic Acid', 'Folic Acid', ['5 mg Tablets (100)' => 150]],
                ['Sunny D', 'Vitamin D3', ['200,000 IU Capsule' => 190, 'STAT Injection' => 290]], ['Centrum', 'Multivitamin', ['Adults Tablets (30)' => 1890, 'Silver Tablets (30)' => 2090]],
                ['Ensure', 'Nutrition Powder', ['Vanilla 400 g' => 2390, 'Chocolate 400 g' => 2390, 'Vanilla 850 g' => 4690]], ['Glucerna', 'Diabetic Nutrition', ['Vanilla 400 g' => 2690]],
                ['Evion', 'Vitamin E', ['400 mg Capsules (30)' => 420]], ['Cecon', 'Vitamin C', ['500 mg Tablets (20)' => 150]], ['Qalsan-D', 'Calcium + Vitamin D', ['Tablets (30)' => 390]],
                ['Fefol', 'Iron + Vitamins', ['Vit Capsules (30)' => 460]], ['Omega-3', 'Fish Oil', ['1000 mg Softgels (30)' => 1290]], ['Biotin', 'Biotin', ['5 mg Tablets (30)' => 890]],
            ],
            'Skin Care' => [
                ['Betnovate', 'Betamethasone', ['Cream 20 g' => 120, 'N Cream 20 g' => 140]], ['Dermovate', 'Clobetasol', ['Cream 20 g' => 190, 'Ointment 20 g' => 190]],
                ['Polyfax', 'Polymyxin + Bacitracin', ['Skin Ointment 20 g' => 190]], ['Fucidin', 'Fusidic Acid', ['Cream 15 g' => 390, 'H Cream 15 g' => 460]],
                ['Hydrozole', 'Clotrimazole + Hydrocortisone', ['Cream 10 g' => 190]], ['Travocort', 'Isoconazole + Diflucortolone', ['Cream 10 g' => 320]],
                ['Canesten', 'Clotrimazole', ['Cream 20 g' => 290]], ['Nizoral', 'Ketoconazole', ['Shampoo 60 ml' => 590, 'Cream 15 g' => 320]],
                ['Calamine', 'Calamine', ['Lotion 100 ml' => 150]], ['Cetaphil', 'Cleanser', ['Gentle Cleanser 125 ml' => 1690, 'Moisturising Lotion 118 ml' => 1890]],
                ['Sunblock', 'Sunscreen', ['SPF 60 Lotion 60 ml' => 890, 'SPF 100 Cream 45 g' => 1190]], ['Acne-Aid', 'Cleansing Bar', ['Bar 100 g' => 690]],
                ['Scabion', 'Permethrin', ['Lotion 60 ml' => 220]], ['Burnol', 'Burn Cream', ['Cream 20 g' => 160]],
            ],
            'Eye, Ear & Mouth' => [
                ['Tobrex', 'Tobramycin', ['Eye Drops 5 ml' => 290]], ['Optive', 'Lubricant', ['Eye Drops 10 ml' => 690]], ['Visine', 'Tetrahydrozoline', ['Eye Drops 15 ml' => 420]],
                ['Betnesol', 'Betamethasone', ['Eye/Ear Drops 7.5 ml' => 120]], ['Otosporin', 'Ear Antibiotic', ['Ear Drops 5 ml' => 190]], ['Somogel', 'Mouth Ulcer Gel', ['Gel 10 g' => 190]],
                ['Enziclor', 'Chlorhexidine', ['Mouthwash 120 ml' => 260]], ['Listerine', 'Mouthwash', ['Cool Mint 250 ml' => 690]],
            ],
            'Mother & Baby' => [
                ["Woodward's Gripe Water", 'Gripe Water', ['130 ml' => 320]], ['Colic', 'Simethicone', ['Drops 20 ml' => 150]], ['Sudocrem', 'Nappy Rash Cream', ['Cream 60 g' => 890, 'Cream 125 g' => 1490]],
                ['Zincat', 'Zinc Sulphate', ['Syrup 60 ml' => 110]], ['Brufen', 'Ibuprofen', ['Junior Suspension 90 ml' => 130]], ['Pampers Diapers', 'Diapers', ['Small (36)' => 1490, 'Medium (34)' => 1590]],
                ['Lactogen 1', 'Infant Formula', ['400 g' => 1590]], ['NAN 1', 'Infant Formula', ['400 g' => 2190]], ['Avent Feeding Bottle', 'Feeding Bottle', ['125 ml' => 1490, '260 ml' => 1790]],
                ['Clearblue', 'Pregnancy Test', ['Test Kit' => 590]], ['Pregnacare', 'Prenatal Multivitamin', ['Tablets (30)' => 1690]],
            ],
            'First Aid & Devices' => [
                ['Dettol Antiseptic', 'Chloroxylenol', ['50 ml' => 120, '100 ml' => 220, '500 ml' => 890]], ['Pyodine', 'Povidone Iodine', ['Solution 60 ml' => 190, 'Scrub 60 ml' => 220]],
                ['Saniplast', 'Adhesive Bandage', ['Strips (20)' => 90, 'Strips (100)' => 390]], ['Absorbent Cotton', 'Cotton Wool', ['50 g' => 70, '100 g' => 130, '400 g' => 460]],
                ['Crepe Bandage', 'Elastic Bandage', ['2 inch' => 90, '4 inch' => 150, '6 inch' => 220]], ['Surgical Face Masks', 'Face Mask', ['3-ply (50)' => 390]], ['KN95 Face Mask', 'Face Mask', ['Single' => 90, 'Box (10)' => 790]],
                ['Latex Gloves', 'Examination Gloves', ['Medium (100)' => 1290, 'Large (100)' => 1290]], ['BD Syringes', 'Disposable Syringe', ['3 ml (10)' => 150, '5 ml (10)' => 190, '10 ml (10)' => 260]],
                ['Omron BP Monitor', 'Blood Pressure Monitor', ['M2 Basic' => 9490, 'M3 Comfort' => 13990]], ['Certeza Digital Thermometer', 'Thermometer', ['DT-801' => 590]], ['Certeza Glucometer', 'Glucometer', ['GL-110 Kit' => 3490]],
                ['Certeza Nebulizer', 'Nebulizer', ['NB-607' => 6990]], ['Hot Water Bottle', 'Hot Water Bottle', ['2 L' => 690]], ['Hand Sanitizer', 'Alcohol Gel', ['60 ml' => 150, '250 ml' => 390, '500 ml' => 690]],
            ],
        ];

        $out = [];
        foreach ($shelves as $shelf => $families) {
            foreach ($families as [$brand, $salt, $packs]) {
                foreach ($packs as $pack => $price) {
                    $out[] = ['category' => $shelf, 'name' => "{$brand} {$pack}", 'price' => $price, 'brand' => $brand, 'generic' => $salt, 'by_weight' => false];
                }
            }
        }

        return $out;
    }

    /**
     * A clothing shop. Each line is a DESIGN — it comes in sizes, and some in
     * colours, which the shop builder lays out as a grid.
     *
     * @return array<int, Line>
     */
    public static function clothing(): array
    {
        $rails = [
            "Women's Unstitched" => [['Printed Lawn', 4490], ['Embroidered Lawn', 7990], ['Chikankari Lawn', 9490], ['Digital Print Silk', 8990], ['Cambric Print', 4990], ['Khaddar Winter', 5490], ['Linen Print', 5990], ['Karandi Embroidered', 8490]],
            "Women's Kurti" => [['Printed Lawn', 2490], ['Embroidered Lawn', 3490], ['Chikankari', 4490], ['Cotton Net', 4990], ['Khaddar', 2990], ['Linen', 3290], ['Cambric', 2790], ['Block Print', 2690], ['Schiffli', 3990], ['Jacquard', 3690]],
            "Women's Formals" => [['Chiffon Embroidered', 14990], ['Organza Embroidered', 16990], ['Raw Silk', 12990], ['Velvet Embroidered', 18990], ['Net Embroidered', 15990], ['Banarsi Jacquard', 13990]],
            "Women's Bottoms" => [['Cotton Trouser', 1690], ['Cigarette Pants', 1990], ['Culottes', 2190], ['Printed Shalwar', 1490], ['Tulip Shalwar', 1790], ['Palazzo', 1990], ['Tights', 990]],
            "Men's Eastern" => [['Cotton Kurta', 3490], ['Wash & Wear Kurta', 2990], ['Linen Kurta', 4290], ['Embroidered Kurta', 5490], ['Wash & Wear Shalwar Kameez', 5990], ['Cotton Shalwar Kameez', 6490], ['Boski Shalwar Kameez', 12990], ['Karandi Shalwar Kameez', 7990], ['Khaddar Shalwar Kameez', 6990], ['Latha Shalwar Kameez', 5490], ['Kurta Pajama', 5990], ['Waistcoat', 4990], ['Embroidered Waistcoat', 7490], ['Prince Coat', 14990]],
            "Men's Western" => [['Polo Shirt', 2490], ['Graphic T-Shirt', 1690], ['Plain T-Shirt', 1290], ['Formal Shirt', 3290], ['Casual Check Shirt', 2990], ['Oxford Shirt', 3490], ['Slim Fit Jeans', 3990], ['Straight Fit Jeans', 3990], ['Chino Pants', 3490], ['Dress Pants', 3690], ['Hoodie', 3990], ['Sweatshirt', 3290], ['Zipper Jacket', 5490], ['Track Pants', 2290]],
            'Boys' => [['Kurta Shalwar', 2990], ['Waistcoat Suit', 4490], ['Polo Shirt', 1490], ['Graphic T-Shirt', 1090], ['Denim Jeans', 2190], ['Shorts', 1190], ['Hoodie', 2490]],
            'Girls' => [['Printed Frock', 2490], ['Embroidered Frock', 3490], ['Lawn 2-Piece', 2990], ['Party Dress', 4990], ['Kurti', 1790], ['Tights', 690], ['Denim Jacket', 2990]],
            'Abayas & Scarves' => [['Nida Abaya', 5990], ['Front Open Abaya', 6990], ['Embroidered Abaya', 8990], ['Georgette Hijab', 990], ['Jersey Hijab', 890], ['Lawn Dupatta', 1290], ['Chiffon Dupatta', 1690], ['Printed Stole', 1490], ['Pashmina Shawl', 6990]],
        ];

        $out = [];
        foreach ($rails as $rail => $designs) {
            $who = match (true) {
                str_starts_with($rail, "Women's") => "Women's ",
                str_starts_with($rail, "Men's") => "Men's ",
                $rail === 'Boys' => "Boys' ",
                $rail === 'Girls' => "Girls' ",
                default => '',
            };
            $what = match ($rail) {
                "Women's Unstitched" => ' 3-Piece Suit',
                "Women's Kurti" => ' Kurti',
                "Women's Formals" => ' Formal Suit',
                default => '',
            };
            foreach ($designs as [$design, $price]) {
                $out[] = ['category' => $rail, 'name' => "{$who}{$design}{$what}", 'price' => $price, 'brand' => null, 'by_weight' => false];
            }
        }

        return $out;
    }

    /** @return array<int, Line> a workshop's parts shelf */
    public static function workshop(): array
    {
        $cars = ['Suzuki Mehran', 'Suzuki Alto', 'Suzuki Cultus', 'Suzuki Wagon R', 'Toyota Corolla', 'Toyota Yaris', 'Honda City', 'Honda Civic', 'KIA Sportage', 'Hyundai Tucson'];
        // [part, shelf, what it costs on a small car] — a bigger car's is dearer.
        $parts = [
            ['Front Brake Pads', 'Brakes', 2490], ['Rear Brake Shoes', 'Brakes', 2190], ['Brake Disc Rotor', 'Brakes', 5490], ['Oil Filter', 'Filters', 590],
            ['Air Filter', 'Filters', 890], ['Cabin AC Filter', 'Filters', 990], ['Fuel Filter', 'Filters', 1290], ['Spark Plug (Set of 4)', 'Engine', 2490],
            ['Timing Belt', 'Engine', 3490], ['Fan Belt', 'Engine', 1490], ['Engine Mounting', 'Engine', 2990], ['Radiator', 'Engine', 12990],
            ['Water Pump', 'Engine', 4490], ['Clutch Plate', 'Engine', 6990], ['Front Shock Absorber', 'Suspension', 7490], ['Rear Shock Absorber', 'Suspension', 5990],
            ['Ball Joint', 'Suspension', 2290], ['Tie Rod End', 'Suspension', 1990], ['Wheel Bearing', 'Suspension', 2990], ['Headlamp Assembly', 'Electrical', 9990],
            ['Tail Lamp', 'Electrical', 5490], ['Wiper Blades (Pair)', 'Body', 1490], ['Side Mirror', 'Body', 4990],
        ];
        $big = ['Toyota Corolla' => 1.35, 'Toyota Yaris' => 1.25, 'Honda City' => 1.3, 'Honda Civic' => 1.6, 'KIA Sportage' => 1.9, 'Hyundai Tucson' => 1.9];

        $out = [];
        foreach ($parts as [$part, $shelf, $price]) {
            foreach ($cars as $car) {
                $out[] = [
                    'category' => $shelf, 'name' => "{$part} — {$car}",
                    'price' => (int) (round($price * ($big[$car] ?? 1) / 10) * 10), 'brand' => null, 'by_weight' => false,
                ];
            }
        }

        foreach ([
            ['AGS', 'Battery GL-48 (11 plates)', 'Batteries', 12990], ['AGS', 'Battery GL-65 (13 plates)', 'Batteries', 16490], ['Exide', 'Battery NS40', 'Batteries', 11990],
            ['Exide', 'Battery NS70', 'Batteries', 19990], ['Osaka', 'Battery MF-50', 'Batteries', 13490], ['Osaka', 'Battery Platinum 100', 'Batteries', 24990],
            ['Volta', 'Battery CNG-50', 'Batteries', 12490], ['General', 'Tyre 145/80 R12', 'Tyres', 9990], ['General', 'Tyre 165/65 R13', 'Tyres', 12490],
            ['General', 'Tyre 175/65 R14', 'Tyres', 14990], ['Servis', 'Tyre 195/65 R15', 'Tyres', 19990], ['Dunlop', 'Tyre 205/55 R16', 'Tyres', 32990],
            ['Yokohama', 'Tyre 225/60 R17', 'Tyres', 46990], ['Shell', 'Helix HX5 20W-50 (4 L)', 'Fluids', 5990], ['Shell', 'Helix HX7 10W-40 (4 L)', 'Fluids', 8490],
            ['Caltex', 'Havoline 20W-50 (4 L)', 'Fluids', 5790], ['ZIC', 'X7 5W-30 (4 L)', 'Fluids', 9490], ['Toyota', 'Genuine Motor Oil 10W-30 (4 L)', 'Fluids', 7990],
            ['Honda', 'Genuine Oil 5W-30 (4 L)', 'Fluids', 8990], ['Prestone', 'Coolant (1 L)', 'Fluids', 1290], ['Prestone', 'Coolant (4 L)', 'Fluids', 4490],
            ['Toyota', 'Brake Fluid DOT 3 (500 ml)', 'Fluids', 1190], ['Guard', 'Gear Oil 80W-90 (1 L)', 'Fluids', 1490], ['Honda', 'ATF DW-1 (1 L)', 'Fluids', 2890],
        ] as [$brand, $thing, $shelf, $price]) {
            $out[] = ['category' => $shelf, 'name' => "{$brand} {$thing}", 'price' => $price, 'brand' => $brand, 'by_weight' => false];
        }

        return $out;
    }

    /** @return array<int, Line> the shop behind a filling station's pumps */
    public static function forecourtShop(): array
    {
        $out = [];
        $oils = [
            'Engine Oil' => [
                ['Shell', 'Helix HX3 20W-50', ['1 L' => 1590, '3 L' => 4490, '4 L' => 5790]], ['Shell', 'Helix HX5 15W-40', ['1 L' => 1790, '4 L' => 6490]],
                ['Shell', 'Helix HX7 10W-40', ['1 L' => 2390, '4 L' => 8490]], ['Shell', 'Rimula R2 Diesel', ['4 L' => 5990, '10 L' => 14490]],
                ['Caltex', 'Havoline 20W-50', ['1 L' => 1550, '3 L' => 4390, '4 L' => 5690]], ['Caltex', 'Delo Gold Diesel', ['4 L' => 6190, '10 L' => 14990]],
                ['ZIC', 'M7 4T 20W-40 (Bike)', ['700 ml' => 1090, '1 L' => 1490]], ['ZIC', 'X5 10W-40', ['4 L' => 7990]], ['ZIC', 'X7 5W-30', ['4 L' => 9490]],
                ['Total', 'Quartz 5000 20W-50', ['1 L' => 1590, '4 L' => 5890]], ['Total', 'Quartz 7000 10W-40', ['4 L' => 8290]], ['PSO', 'Carient Plus 20W-50', ['1 L' => 1450, '3 L' => 4090, '4 L' => 5290]],
                ['PSO', 'Carient Ultra 10W-40', ['4 L' => 7490]], ['Castrol', 'GTX 20W-50', ['1 L' => 1690, '4 L' => 6190]], ['Castrol', 'Activ 4T (Bike)', ['700 ml' => 1050, '1 L' => 1450]],
                ['Kixx', 'G1 5W-30', ['4 L' => 8990]], ['Honda', '4-Stroke Bike Oil', ['700 ml' => 990, '1 L' => 1350]], ['Havoline', '2T Two-Stroke Oil', ['1 L' => 1290]],
            ],
            'Gear & Transmission' => [
                ['Shell', 'Spirax S2 80W-90', ['1 L' => 1590]], ['Caltex', 'Thuban GL-5 85W-140', ['1 L' => 1690]], ['PSO', 'Gear Oil EP-90', ['1 L' => 1390]],
                ['Honda', 'ATF DW-1', ['1 L' => 2890]], ['Toyota', 'ATF WS', ['1 L' => 2990]], ['Shell', 'ATF Dexron III', ['1 L' => 2190]],
            ],
            'Coolant & Brake Fluid' => [
                ['Prestone', 'Coolant', ['1 L' => 1290, '4 L' => 4490]], ['Shell', 'Coolant Longlife', ['1 L' => 1190, '4 L' => 4190]], ['Caltex', 'Coolant', ['1 L' => 1090]],
                ['Toyota', 'Brake Fluid DOT 3', ['250 ml' => 690, '500 ml' => 1190]], ['Shell', 'Brake Fluid DOT 4', ['500 ml' => 1390]], ['Guard', 'Distilled Battery Water', ['1 L' => 190]],
                ['Shell', 'Windscreen Wash', ['500 ml' => 490]],
            ],
            'Filters & Wipers' => [
                ['Guard', 'Oil Filter (Suzuki)', ['each' => 590]], ['Guard', 'Oil Filter (Toyota)', ['each' => 690]], ['Guard', 'Oil Filter (Honda)', ['each' => 690]],
                ['Guard', 'Air Filter (Suzuki)', ['each' => 890]], ['Guard', 'Air Filter (Toyota)', ['each' => 1090]], ['Guard', 'Air Filter (Honda)', ['each' => 1090]],
                ['Bosch', 'Wiper Blade 16 inch', ['each' => 890]], ['Bosch', 'Wiper Blade 20 inch', ['each' => 990]], ['Bosch', 'Wiper Blade 24 inch', ['each' => 1190]],
            ],
            'Car Care' => [
                ['Turtle Wax', 'Car Shampoo', ['500 ml' => 1290]], ['Turtle Wax', 'Super Hard Shell Polish', ['500 ml' => 1890]], ['Armor All', 'Dashboard Protectant', ['300 ml' => 1490]],
                ['Flamingo', 'Dashboard Polish', ['450 ml' => 690]], ['Flamingo', 'Tyre Shine', ['450 ml' => 790]], ['Little Trees', 'Air Freshener', ['each' => 390]],
                ['Areon', 'Car Perfume Gel', ['each' => 890]], ['', 'Microfibre Cloth', ['each' => 290]], ['', 'Tyre Puncture Kit', ['each' => 1490]], ['', 'Jump Start Cables', ['each' => 2490]],
                ['WD-40', 'Multi-Use Spray', ['330 ml' => 1190]], ['', 'Octane Booster', ['300 ml' => 890]], ['', 'Injector Cleaner', ['300 ml' => 990]],
            ],
            'Tuck Shop' => [
                ['Coca-Cola', '', ['500 ml' => 120, '1.5 L' => 230]], ['Pepsi', '', ['500 ml' => 120, '1.5 L' => 230]], ['Sprite', '', ['500 ml' => 120]], ['7UP', '', ['500 ml' => 120]],
                ['Mountain Dew', '', ['500 ml' => 120]], ['Sting', 'Energy Drink', ['500 ml' => 160]], ['Red Bull', 'Energy Drink', ['250 ml' => 550]],
                ['Nestlé', 'Pure Life Water', ['500 ml' => 70, '1.5 L' => 120]], ['Nestlé', 'Fruita Vitals Mango', ['200 ml' => 90]], ['Olpers', 'Flavoured Milk', ['200 ml' => 110]],
                ["Lay's", 'Masala', ['small' => 50, 'large' => 120]], ["Lay's", 'Salted', ['small' => 50, 'large' => 120]], ['Kurkure', 'Chutney Chaska', ['small' => 40]],
                ['Peek Freans', 'Sooper', ['half roll' => 60]], ['LU', 'Prince Chocolate', ['half roll' => 80]], ['LU', 'Tuc', ['half roll' => 70]],
                ['Cadbury', 'Dairy Milk', ['24 g' => 100, '56 g' => 220]], ['KitKat', '4 Finger', ['41 g' => 180]], ['Snickers', 'Bar', ['50 g' => 220]],
                ['Nescafé', 'Coffee (Cup)', ['cup' => 150]], ['', 'Doodh Patti (Cup)', ['cup' => 100]], ['', 'Chicken Sandwich', ['each' => 290]], ['', 'Chicken Patty', ['each' => 150]],
                ['Tapal', 'Matchbox', ['each' => 10]], ['', 'Tissue Pack', ['each' => 60]], ['', 'Mobile Charging Cable', ['each' => 490]], ['', 'Mobile Car Charger', ['each' => 990]],
            ],
        ];

        foreach ($oils as $shelf => $families) {
            foreach ($families as [$brand, $thing, $packs]) {
                foreach ($packs as $pack => $price) {
                    $suffix = in_array($pack, ['each', 'cup'], true) ? '' : ' '.$pack;
                    $out[] = ['category' => $shelf, 'name' => trim(trim("{$brand} {$thing}").$suffix), 'price' => $price, 'brand' => $brand !== '' ? $brand : null, 'by_weight' => false];
                }
            }
        }

        return $out;
    }

    /** @return array<int, Line> a repair centre's price list — labour, not goods */
    public static function repairCentre(): array
    {
        $desks = [
            'Air Conditioner' => [
                'AC General Service (Split)' => 2500, 'AC Master Service with Chemical Wash' => 4500, 'AC Gas Refill R-410' => 6500, 'AC Gas Refill R-22' => 5500,
                'AC Installation (1 Ton)' => 3500, 'AC Installation (1.5 Ton)' => 4000, 'AC Installation (2 Ton)' => 5000, 'AC Dismantling' => 1500,
                'AC PCB Repair' => 5500, 'AC Compressor Replacement (Labour)' => 6000, 'AC Leakage Repair' => 3500, 'Window AC Service' => 2000,
            ],
            'Refrigerator & Freezer' => [
                'Refrigerator Inspection' => 1000, 'Refrigerator Gas Refill' => 4500, 'Refrigerator Compressor Replacement (Labour)' => 5500, 'Thermostat Replacement' => 2500,
                'Door Gasket Replacement' => 3000, 'Deep Freezer Gas Refill' => 5500, 'Deep Freezer Repair' => 4000, 'Water Dispenser Repair' => 2500,
            ],
            'Washing Machine' => [
                'Washing Machine Inspection' => 1000, 'Automatic Machine Repair' => 4500, 'Semi-Automatic Machine Repair' => 2500, 'Drum Bearing Replacement' => 5500,
                'Motor Rewinding' => 4000, 'Drain Pump Replacement' => 3000, 'Machine PCB Repair' => 6000, 'Dryer Repair' => 3500,
            ],
            'Kitchen Appliances' => [
                'Microwave Oven Repair' => 2500, 'Microwave Magnetron Replacement' => 5500, 'Geyser Service' => 2000, 'Geyser Thermostat Replacement' => 2500,
                'Instant Geyser Installation' => 3000, 'Cooking Range Service' => 2500, 'Kitchen Hood Service' => 3000, 'Water Filter Installation' => 2000,
                'Water Filter Cartridge Change' => 1500, 'Juicer / Blender Repair' => 1500,
            ],
            'Mobile Phones' => [
                'Phone Inspection' => 500, 'Screen Replacement — iPhone' => 18000, 'Screen Replacement — Samsung' => 12000, 'Screen Replacement — Infinix / Tecno' => 6500,
                'Battery Replacement — iPhone' => 7500, 'Battery Replacement — Android' => 3500, 'Charging Port Repair' => 2500, 'Water Damage Treatment' => 4500,
                'Software Flashing' => 1500, 'Back Glass Replacement' => 4500, 'Speaker / Mic Repair' => 2000, 'Data Recovery' => 5000,
            ],
            'Laptops & Computers' => [
                'Laptop Inspection' => 1000, 'Windows Installation' => 2000, 'SSD Upgrade (Labour)' => 1500, 'RAM Upgrade (Labour)' => 1000, 'Laptop Screen Replacement' => 14000,
                'Keyboard Replacement' => 5500, 'Laptop Battery Replacement' => 7500, 'Thermal Paste & Cleaning' => 2500, 'Motherboard Repair' => 8500,
                'Virus Removal' => 1500, 'Data Backup & Transfer' => 2500, 'Printer Repair' => 3000,
            ],
            'TV & Electronics' => [
                'LED TV Inspection' => 1000, 'LED TV Panel Repair' => 12000, 'LED TV Backlight Replacement' => 7500, 'LED TV Wall Mounting' => 2000,
                'TV Power Supply Repair' => 4500, 'Home Theatre Repair' => 3500, 'UPS / Inverter Repair' => 4500, 'UPS Battery Replacement (Labour)' => 1500,
                'Stabiliser Repair' => 2000, 'CCTV Camera Installation (per camera)' => 2500, 'CCTV DVR Setup' => 3500,
            ],
            'Home Visits' => [
                'Electrician Visit' => 1500, 'Plumber Visit' => 1500, 'Fan Installation' => 800, 'Fan Winding' => 1800, 'Switchboard Repair' => 1000,
                'Water Motor Repair' => 3500, 'Water Tank Cleaning' => 4500, 'Generator Tune-up' => 5500, 'Solar Panel Cleaning' => 3000, 'Annual Maintenance Contract' => 24000,
            ],
        ];

        $out = [];
        foreach ($desks as $desk => $jobs) {
            foreach ($jobs as $job => $price) {
                $out[] = ['category' => $desk, 'name' => $job, 'price' => $price, 'brand' => null, 'by_weight' => false];
            }
        }

        return $out;
    }

    /** @return array<int, Line> an online gadget store */
    public static function gadgetStore(): array
    {
        $shelves = [
            'Chargers & Cables' => [
                ['Anker', 'PowerPort 20W Charger', 3490], ['Anker', 'Nano 30W Charger', 4990], ['Anker', 'PowerLine USB-C Cable 1 m', 1990], ['Anker', 'PowerLine Lightning Cable 1 m', 2490],
                ['Baseus', '65W GaN Charger', 8990], ['Baseus', '20W Fast Charger', 2490], ['Baseus', 'USB-C to USB-C Cable 100W', 1690], ['Baseus', '3-in-1 Charging Cable', 1490],
                ['Ugreen', '45W Dual Port Charger', 5490], ['Ugreen', 'USB-C to Lightning Cable', 2290], ['Samsung', '25W Super Fast Charger', 4490], ['Apple', '20W USB-C Power Adapter', 6490],
                ['Xiaomi', '33W Charger', 2990], ['Baseus', 'Car Charger 30W', 2490], ['Anker', 'Car Charger Dual Port', 2990], ['Ugreen', 'Wireless Charger 15W', 4490],
            ],
            'Power Banks' => [
                ['Anker', 'PowerCore 10000 mAh', 7490], ['Anker', 'PowerCore 20000 mAh', 11990], ['Baseus', 'Bipow 10000 mAh', 5490], ['Baseus', 'Bipow 20000 mAh', 7990],
                ['Xiaomi', 'Power Bank 10000 mAh', 4990], ['Xiaomi', 'Power Bank 20000 mAh', 7490], ['Romoss', 'Sense 4 10000 mAh', 3990], ['Romoss', 'Sense 8 30000 mAh', 8990],
                ['Samsung', 'Wireless Power Bank 10000 mAh', 9990], ['Ugreen', 'MagSafe Power Bank 10000 mAh', 9490],
            ],
            'Earbuds & Headphones' => [
                ['Apple', 'AirPods (3rd Gen)', 54990], ['Apple', 'AirPods Pro 2', 74990], ['Samsung', 'Galaxy Buds FE', 24990], ['Samsung', 'Galaxy Buds2 Pro', 44990],
                ['Anker', 'Soundcore Life P3', 13990], ['Anker', 'Soundcore Liberty 4', 28990], ['Xiaomi', 'Redmi Buds 4 Lite', 5990], ['Xiaomi', 'Redmi Buds 5', 9990],
                ['QCY', 'T13 ANC Earbuds', 6490], ['QCY', 'HT05 Earbuds', 7990], ['Audionic', 'Airbud 550', 4990], ['Audionic', 'Signature S-650', 6990],
                ['JBL', 'Tune 520BT Headphones', 15990], ['JBL', 'Wave Buds', 12990], ['Sony', 'WH-CH520 Headphones', 16990], ['Sony', 'WF-C500 Earbuds', 21990],
                ['Baseus', 'Bowie E3 Earbuds', 5490], ['Lenovo', 'LP40 Pro Earbuds', 3990],
            ],
            'Smart Watches' => [
                ['Apple', 'Watch SE 44 mm', 89990], ['Apple', 'Watch Series 9 45 mm', 139990], ['Samsung', 'Galaxy Watch 6 44 mm', 79990], ['Xiaomi', 'Redmi Watch 4', 24990],
                ['Xiaomi', 'Smart Band 8', 11990], ['Amazfit', 'Bip 5', 22990], ['Amazfit', 'GTS 4 Mini', 29990], ['Haylou', 'Solar Plus RT3', 13990], ['Zero', 'Luna Smart Watch', 14990],
                ['Zero', 'Revoltt Smart Watch', 9990], ['Ronin', 'R-09 Smart Watch', 8990], ['Yolo', 'Fortuner Pro', 12990],
            ],
            'Phone Cases & Glass' => [
                ['Spigen', 'Liquid Air Case — iPhone 15', 4990], ['Spigen', 'Ultra Hybrid Case — iPhone 15 Pro', 5490], ['Spigen', 'Rugged Armor Case — Galaxy S24', 4990],
                ['Ringke', 'Fusion Case — iPhone 14', 3990], ['Ringke', 'Onyx Case — Galaxy A54', 2990], ['Nillkin', 'CamShield Case — iPhone 15 Pro Max', 3490],
                ['Nillkin', 'Frosted Shield — Redmi Note 13', 2290], ['', 'Silicone Case — iPhone 13', 1490], ['', 'Silicone Case — Galaxy A15', 990], ['', 'Clear Case — Infinix Hot 40', 790],
                ['Spigen', 'Tempered Glass — iPhone 15', 2990], ['Nillkin', 'Tempered Glass — Galaxy S24', 2490], ['', 'Tempered Glass — Redmi Note 13', 690], ['', 'Privacy Glass — iPhone 14', 1290],
                ['', 'Camera Lens Protector — iPhone 15 Pro', 990], ['', 'Phone Ring Holder', 490], ['Baseus', 'MagSafe Card Wallet', 2490],
            ],
            'Speakers' => [
                ['JBL', 'Go 3', 12990], ['JBL', 'Flip 6', 34990], ['JBL', 'Charge 5', 49990], ['Anker', 'Soundcore 2', 12990], ['Anker', 'Soundcore Motion Boom', 28990],
                ['Audionic', 'Mehfil MH-50', 14990], ['Audionic', 'Pace 5 Soundbar', 24990], ['Xiaomi', 'Portable Bluetooth Speaker', 9990], ['Sony', 'SRS-XB100', 16990],
            ],
            'Computer Accessories' => [
                ['Logitech', 'M185 Wireless Mouse', 3490], ['Logitech', 'M331 Silent Mouse', 5490], ['Logitech', 'MX Master 3S', 32990], ['Logitech', 'K380 Bluetooth Keyboard', 10990],
                ['Logitech', 'MK270 Keyboard & Mouse', 7990], ['Redragon', 'K552 Mechanical Keyboard', 12990], ['Redragon', 'M711 Gaming Mouse', 6490], ['A4Tech', 'FG1010 Keyboard & Mouse', 4990],
                ['SanDisk', 'Ultra Flair USB 64 GB', 2490], ['SanDisk', 'Ultra Flair USB 128 GB', 3990], ['SanDisk', 'Extreme microSD 128 GB', 5990], ['Samsung', 'EVO Plus microSD 256 GB', 8990],
                ['WD', 'My Passport 1 TB', 19990], ['Samsung', 'T7 Portable SSD 1 TB', 36990], ['Ugreen', 'USB-C Hub 6-in-1', 8990], ['Baseus', 'Laptop Stand', 5490],
                ['Ugreen', 'HDMI Cable 2 m', 1990], ['TP-Link', 'Archer C6 Router', 12990], ['TP-Link', 'USB WiFi Adapter', 2990], ['Logitech', 'C270 Webcam', 8990],
            ],
            'Phone Holders & Gimbals' => [
                ['Baseus', 'Car Phone Mount', 2490], ['Ugreen', 'Dashboard Phone Holder', 2990], ['', 'Bike Phone Holder', 1490], ['', 'Desk Phone Stand', 990],
                ['', 'Selfie Stick Tripod', 2490], ['', 'Ring Light 10 inch', 3990], ['DJI', 'Osmo Mobile SE Gimbal', 32990], ['Boya', 'BY-M1 Lavalier Mic', 4490],
            ],
        ];

        $out = [];
        foreach ($shelves as $shelf => $things) {
            foreach ($things as [$brand, $thing, $price]) {
                $out[] = ['category' => $shelf, 'name' => trim("{$brand} {$thing}"), 'price' => $price, 'brand' => $brand !== '' ? $brand : null, 'by_weight' => false];
            }
        }

        return $out;
    }
}
