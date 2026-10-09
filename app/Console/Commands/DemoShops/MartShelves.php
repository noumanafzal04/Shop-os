<?php

namespace App\Console\Commands\DemoShops;

use App\Console\Commands\SeedDemoShops;

/**
 * A Pakistani mart's shelves: the brands a shopper asks for by name, in the
 * sizes they are actually packed in.
 *
 * `[brand, product, [size => rupees]]` — one line per pack size, because a
 * 190 g and a 950 g of the same tea are two things on the shelf with two
 * barcodes. A brand of `''` is something the shop packs or weighs itself.
 *
 * `WEIGHED` are the aisles sold by the kilo off a scale.
 *
 * @see SeedDemoShops
 */
final class MartShelves
{
    public const WEIGHED = ['Fruit & Vegetables', 'Loose & Weighed'];

    /** @return array<string, array<int, array{0: string, 1: string, 2: array<string, int>}>> */
    public static function aisles(): array
    {
        return [
            'Rice & Pulses' => [
                ['Guard', 'Basmati Rice', ['1 kg' => 430, '5 kg' => 2090]], ['Falak', 'Extreme Basmati Rice', ['1 kg' => 460, '5 kg' => 2250]],
                ['Kernel', 'Super Basmati Rice', ['2 kg' => 820, '5 kg' => 1990]], ['Kainaat', '1121 Sella Rice', ['5 kg' => 1950]],
                ['Reem', 'Steam Basmati Rice', ['1 kg' => 440, '5 kg' => 2150]], ['Mughal', 'Sella Rice', ['5 kg' => 1890]],
                ['', 'Daal Chana', ['500 g' => 195, '1 kg' => 380]], ['', 'Daal Masoor', ['500 g' => 185, '1 kg' => 360]],
                ['', 'Daal Moong', ['500 g' => 215, '1 kg' => 420]], ['', 'Daal Mash', ['500 g' => 285, '1 kg' => 560]],
                ['', 'Kala Chana', ['500 g' => 175, '1 kg' => 340]], ['', 'Safaid Chana', ['500 g' => 205, '1 kg' => 400]],
                ['', 'Lobia', ['500 g' => 190, '1 kg' => 370]], ['', 'Red Beans (Rajma)', ['500 g' => 260, '1 kg' => 510]],
            ],
            'Flour & Baking' => [
                ['Sunridge', 'Chakki Atta', ['5 kg' => 890, '10 kg' => 1750]], ['Bake Parlor', 'Fine Atta', ['5 kg' => 860, '10 kg' => 1690]],
                ['Anmol', 'Chakki Atta', ['10 kg' => 1650, '20 kg' => 3250]], ['Sunridge', 'Maida', ['1 kg' => 190]], ['Sunridge', 'Suji', ['1 kg' => 200]],
                ['National', 'Baisan', ['500 g' => 230, '1 kg' => 450]], ['Rafhan', 'Corn Flour', ['300 g' => 180]], ['Rafhan', 'Custard Powder', ['300 g' => 220]],
                ['Rafhan', 'Jelly Crystals', ['80 g' => 90]], ['Bake Parlor', 'Baking Powder', ['100 g' => 120]], ['Rossmoor', 'Cocoa Powder', ['100 g' => 290]],
                ['Rossmoor', 'Vanilla Essence', ['28 ml' => 110]], ['', 'Rice Flour', ['500 g' => 150]],
            ],
            'Oil & Ghee' => [
                ['Dalda', 'Cooking Oil', ['1 L' => 560, '3 L' => 1690, '5 L' => 2790]], ['Sufi', 'Cooking Oil', ['1 L' => 550, '3 L' => 1650, '5 L' => 2740]],
                ['Habib', 'Cooking Oil', ['1 L' => 555, '5 L' => 2760]], ['Eva', 'Cooking Oil', ['1 L' => 545, '3 L' => 1640, '5 L' => 2720]],
                ['Mezan', 'Cooking Oil', ['1 L' => 540, '5 L' => 2690]], ['Seasons', 'Canola Oil', ['1 L' => 590, '3 L' => 1750, '5 L' => 2890]],
                ['Dalda', 'Banaspati Ghee', ['1 kg' => 570, '2.5 kg' => 1420, '5 kg' => 2820]], ['Sufi', 'Banaspati Ghee', ['1 kg' => 560, '5 kg' => 2780]],
                ['Kashmir', 'Banaspati Ghee', ['1 kg' => 555, '2.5 kg' => 1390]], ['Nurpur', 'Desi Ghee', ['500 g' => 1390, '1 kg' => 2750]],
                ['Borges', 'Olive Oil', ['250 ml' => 990, '500 ml' => 1890]], ['Sasso', 'Olive Oil', ['250 ml' => 950, '1 L' => 3450]],
            ],
            'Tea & Coffee' => [
                ['Tapal', 'Danedar', ['95 g' => 180, '190 g' => 350, '430 g' => 780, '900 g' => 1590]],
                ['Lipton', 'Yellow Label', ['95 g' => 190, '190 g' => 370, '430 g' => 810, '900 g' => 1650]],
                ['Tapal', 'Family Mixture', ['190 g' => 330, '430 g' => 740]], ['Vital', 'Tea', ['190 g' => 320, '430 g' => 720, '900 g' => 1490]],
                ['Supreme', 'Tea', ['190 g' => 340, '900 g' => 1550]], ['Tapal', 'Green Tea Jasmine (30 bags)', ['box' => 260]],
                ['Tapal', 'Green Tea Lemon (30 bags)', ['box' => 260]], ['Tapal', 'Green Tea Elaichi (30 bags)', ['box' => 260]],
                ['Lipton', 'Green Tea (25 bags)', ['box' => 290]], ['Nescafé', 'Classic', ['50 g' => 590, '100 g' => 1090, '200 g' => 2090]],
                ['Nescafé', 'Gold', ['100 g' => 1890]], ['Nescafé', '3-in-1 (10 sachets)', ['box' => 420]], ['Nestlé', 'Everyday Tea Whitener', ['400 g' => 690, '900 g' => 1490]],
                ['Tarang', 'Tea Whitener', ['250 ml' => 85, '1 L' => 310]], ['Milo', 'Chocolate Drink', ['150 g' => 390, '300 g' => 740]],
            ],
            'Spices & Masala' => [
                ['Shan', 'Biryani Masala', ['50 g' => 130]], ['Shan', 'Bombay Biryani Masala', ['60 g' => 135]], ['Shan', 'Karahi Masala', ['50 g' => 130]],
                ['Shan', 'Qorma Masala', ['50 g' => 130]], ['Shan', 'Nihari Masala', ['60 g' => 135]], ['Shan', 'Tikka Masala', ['50 g' => 130]],
                ['Shan', 'Chicken Masala', ['50 g' => 130]], ['Shan', 'Achar Gosht Masala', ['50 g' => 130]], ['Shan', 'Haleem Mix', ['300 g' => 390]],
                ['Shan', 'Chapli Kabab Masala', ['100 g' => 150]], ['Shan', 'Seekh Kabab Masala', ['50 g' => 130]], ['Shan', 'Fish Masala', ['50 g' => 130]],
                ['Shan', 'Pulao Masala', ['50 g' => 130]], ['Shan', 'Chaat Masala', ['100 g' => 150]], ['National', 'Biryani Masala', ['45 g' => 125]],
                ['National', 'Karahi Masala', ['50 g' => 125]], ['National', 'Qorma Masala', ['50 g' => 125]], ['National', 'Tikka Boti Masala', ['44 g' => 125]],
                ['National', 'Red Chilli Powder', ['100 g' => 170, '200 g' => 330]], ['National', 'Haldi Powder', ['100 g' => 130, '200 g' => 250]],
                ['National', 'Dhania Powder', ['100 g' => 120, '200 g' => 230]], ['National', 'Garam Masala', ['50 g' => 160]],
                ['National', 'Zeera Powder', ['50 g' => 190]], ['National', 'Black Pepper Powder', ['50 g' => 260]], ['National', 'Iodized Salt', ['800 g' => 60]],
                ['Shan', 'Pink Himalayan Salt', ['800 g' => 90]], ['', 'Sabut Zeera', ['100 g' => 280]], ['', 'Sabut Kali Mirch', ['100 g' => 420]],
                ['', 'Elaichi (Green)', ['50 g' => 690]], ['', 'Dar Chini', ['50 g' => 140]], ['', 'Laung', ['50 g' => 290]],
            ],
            'Sauces & Spreads' => [
                ['National', 'Tomato Ketchup', ['500 g' => 290, '1 kg' => 520]], ["Mitchell's", 'Tomato Ketchup', ['500 g' => 310, '825 g' => 480]],
                ['Shangrila', 'Tomato Ketchup', ['500 g' => 270, '1 kg' => 490]], ['Knorr', 'Chilli Garlic Sauce', ['300 g' => 250, '800 g' => 560]],
                ['National', 'Chilli Garlic Sauce', ['300 g' => 230, '800 g' => 520]], ['Shangrila', 'Chilli Sauce', ['300 ml' => 190]],
                ['Shangrila', 'Soy Sauce', ['300 ml' => 190]], ['Shangrila', 'Vinegar', ['300 ml' => 120]], ["Young's", 'Mayonnaise', ['300 ml' => 390, '1 L' => 990]],
                ["Young's", 'Chicken Spread', ['300 ml' => 420]], ["Young's", 'Garlic Mayo', ['300 ml' => 410]], ["Mitchell's", 'Strawberry Jam', ['450 g' => 420]],
                ["Mitchell's", 'Mixed Fruit Jam', ['450 g' => 420]], ["Mitchell's", 'Mango Jam', ['450 g' => 420]], ['National', 'Mixed Fruit Jam', ['440 g' => 390]],
                ['Shezan', 'Apple Jam', ['440 g' => 380]], ['Marhaba', 'Honey', ['250 g' => 590, '500 g' => 1090]], ['Langnese', 'Honey', ['250 g' => 1190]],
                ['American Garden', 'Peanut Butter', ['340 g' => 990]], ['Nutella', 'Hazelnut Spread', ['350 g' => 1490, '750 g' => 2890]],
                ['National', 'Mixed Achar', ['320 g' => 290, '1 kg' => 720]], ['National', 'Mango Achar', ['320 g' => 290]], ['Shan', 'Mixed Pickle', ['300 g' => 280]],
                ['National', 'Imli Sauce', ['300 g' => 210]],
            ],
            'Dairy & Eggs' => [
                ['Olpers', 'Milk', ['250 ml' => 85, '1 L' => 300, '1.5 L' => 440]], ['Milkpak', 'Milk', ['250 ml' => 85, '1 L' => 300, '1.5 L' => 440]],
                ['Nurpur', 'Milk', ['1 L' => 295]], ['Haleeb', 'Milk', ['1 L' => 295]], ['Dayfresh', 'Flavoured Milk Chocolate', ['235 ml' => 110]],
                ['Dayfresh', 'Flavoured Milk Strawberry', ['235 ml' => 110]], ['Prema', 'Fresh Milk', ['1 L' => 310]], ['Olpers', 'Cream', ['200 ml' => 290]],
                ['Milkpak', 'Cream', ['200 ml' => 290]], ['Nurpur', 'Butter', ['100 g' => 290, '200 g' => 560]], ['Lurpak', 'Butter', ['200 g' => 1190]],
                ['Blue Band', 'Margarine', ['100 g' => 170, '250 g' => 390]], ['Adams', 'Cheddar Cheese', ['200 g' => 590, '400 g' => 1150]],
                ['Adams', 'Mozzarella Cheese', ['200 g' => 560, '400 g' => 1090]], ['Happy Cow', 'Cheese Slices (10)', ['200 g' => 590]],
                ['Nestlé', 'Plain Yogurt', ['400 g' => 190, '900 g' => 390]], ['Nestlé', 'Sweet Yogurt', ['400 g' => 210]], ['Nestlé', 'Raita', ['250 g' => 160]],
                ['Nido', 'Fortigrow', ['400 g' => 1090, '900 g' => 2290]], ['', 'Farm Eggs (dozen)', ['12' => 330]], ['', 'Farm Eggs (tray)', ['30' => 800]],
                ['', 'Desi Eggs (dozen)', ['12' => 540]],
            ],
            'Bakery & Breakfast' => [
                ['Dawn', 'Bread', ['small' => 130, 'large' => 220]], ['Dawn', 'Bran Bread', ['large' => 250]], ['Bake Parlor', 'Milky Bread', ['large' => 220]],
                ['Dawn', 'Burger Buns (4)', ['pack' => 160]], ['Dawn', 'Hot Dog Rolls (4)', ['pack' => 160]], ['Bake Parlor', 'Cake Rusk', ['350 g' => 390]],
                ['Dawn', 'Tea Rusk', ['300 g' => 290]], ['Fauji', 'Corn Flakes', ['250 g' => 420, '500 g' => 790]], ["Kellogg's", 'Corn Flakes', ['275 g' => 890, '500 g' => 1490]],
                ["Kellogg's", 'Coco Pops', ['350 g' => 1290]], ['Nestlé', 'Koko Krunch', ['170 g' => 590, '330 g' => 1090]], ['Quaker', 'Oats', ['500 g' => 890, '1 kg' => 1690]],
                ['Fauji', 'Wheat Porridge', ['250 g' => 290]],
            ],
            'Biscuits & Snacks' => [
                ['Peek Freans', 'Sooper', ['ticky pack' => 30, 'half roll' => 60, 'family pack' => 180]], ['Peek Freans', 'Rio Chocolate', ['half roll' => 70, 'family pack' => 190]],
                ['Peek Freans', 'Peanut Pik', ['half roll' => 70, 'family pack' => 190]], ['Peek Freans', 'Marie', ['half roll' => 60, 'family pack' => 170]],
                ['LU', 'Gala', ['ticky pack' => 30, 'half roll' => 60, 'family pack' => 180]], ['LU', 'Prince Chocolate', ['half roll' => 80, 'family pack' => 210]],
                ['LU', 'Tuc', ['half roll' => 70, 'family pack' => 190]], ['LU', 'Candi', ['half roll' => 60, 'family pack' => 170]], ['LU', 'Oreo', ['half roll' => 90, 'family pack' => 240]],
                ['LU', 'Bakeri Nankhatai', ['family pack' => 190]], ['Bisconni', 'Cocomo', ['ticky pack' => 30, 'family pack' => 180]], ['Bisconni', 'Chocolate Chip', ['half roll' => 80]],
                ['EBM', 'Party', ['family pack' => 180]], ["Lay's", 'Salted', ['small' => 50, 'large' => 120]], ["Lay's", 'Masala', ['small' => 50, 'large' => 120]],
                ["Lay's", 'French Cheese', ['small' => 50, 'large' => 120]], ["Lay's", 'Yogurt & Herb', ['small' => 50, 'large' => 120]],
                ['Kurkure', 'Chutney Chaska', ['small' => 40, 'large' => 100]], ['Kurkure', 'Red Chilli Jhatka', ['small' => 40, 'large' => 100]],
                ['Cheetos', 'Ocean Safari', ['small' => 40, 'large' => 100]], ['Kolson', 'Slanty Salted', ['small' => 40, 'large' => 100]],
                ['Kolson', 'Slanty Jalapeño', ['small' => 40, 'large' => 100]], ['Super Crisp', 'BBQ', ['small' => 40, 'large' => 100]],
                ['Nimco', 'Mix', ['200 g' => 220, '400 g' => 420]], ['Nimco', 'Dal Moth', ['200 g' => 230]], ['Mayfair', 'Popcorn', ['pack' => 90]],
                ['Cadbury', 'Dairy Milk', ['24 g' => 100, '56 g' => 220, '90 g' => 390]], ['KitKat', '4 Finger', ['41 g' => 180]], ['Snickers', 'Bar', ['50 g' => 220]],
                ['Mars', 'Bar', ['51 g' => 220]], ['Candyland', 'Chili Mili', ['pack' => 60]], ['Hilal', 'Fresh Up Gum', ['pack' => 30]],
            ],
            'Noodles & Pasta' => [
                ['Knorr', 'Noodles Chicken', ['66 g' => 60, '5-pack' => 290]], ['Knorr', 'Noodles Chatpatta', ['66 g' => 60, '5-pack' => 290]],
                ['Maggi', 'Noodles Chicken', ['65 g' => 60]], ['Maggi', 'Noodles Masala', ['65 g' => 60]], ['Shoop', 'Noodles Chicken', ['65 g' => 55]],
                ['Kolson', 'Spaghetti', ['400 g' => 230]], ['Kolson', 'Elbow Macaroni', ['400 g' => 230]], ['Kolson', 'Penne', ['400 g' => 240]],
                ['Kolson', 'Fusilli', ['400 g' => 240]], ['Kolson', 'Lasagne', ['250 g' => 390]], ['Bake Parlor', 'Vermicelli', ['150 g' => 90]],
                ['Bake Parlor', 'Egg Noodles', ['400 g' => 290]],
            ],
            'Beverages' => [
                ['Coca-Cola', '', ['250 ml' => 70, '500 ml' => 110, '1.5 L' => 220, '2.25 L' => 290]], ['Sprite', '', ['250 ml' => 70, '500 ml' => 110, '1.5 L' => 220]],
                ['Fanta', '', ['500 ml' => 110, '1.5 L' => 220]], ['Pepsi', '', ['250 ml' => 70, '500 ml' => 110, '1.5 L' => 220, '2.25 L' => 290]],
                ['7UP', '', ['500 ml' => 110, '1.5 L' => 220]], ['Mirinda', '', ['500 ml' => 110, '1.5 L' => 220]], ['Mountain Dew', '', ['500 ml' => 110, '1.5 L' => 220]],
                ['Sting', 'Energy Drink Red', ['500 ml' => 150]], ['Sting', 'Energy Drink Gold', ['500 ml' => 150]], ['Red Bull', 'Energy Drink', ['250 ml' => 520]],
                ['Nestlé', 'Pure Life Water', ['500 ml' => 60, '1.5 L' => 110, '5 L' => 260]], ['Aquafina', 'Water', ['500 ml' => 60, '1.5 L' => 110]],
                ['Nestlé', 'Fruita Vitals Mango', ['200 ml' => 80, '1 L' => 340]], ['Nestlé', 'Fruita Vitals Apple', ['200 ml' => 80, '1 L' => 340]],
                ['Nestlé', 'Fruita Vitals Chaunsa', ['200 ml' => 80, '1 L' => 340]], ['Nestlé', 'Fruita Vitals Orange', ['1 L' => 340]],
                ['Shezan', 'Mango Juice', ['250 ml' => 70, '1 L' => 290]], ['Shezan', 'Apple Juice', ['250 ml' => 70, '1 L' => 290]],
                ['Tang', 'Orange', ['375 g' => 490, '750 g' => 930]], ['Tang', 'Mango', ['375 g' => 490]], ['Tang', 'Lemon & Pepper', ['375 g' => 490]],
                ['Rooh Afza', 'Sharbat', ['800 ml' => 620]], ['Jam-e-Shirin', 'Sharbat', ['800 ml' => 590]], ['Slice', 'Mango', ['355 ml' => 90]],
            ],
            'Frozen & Ice Cream' => [
                ["K&N's", 'Chicken Nuggets', ['270 g' => 590, '780 g' => 1590]], ["K&N's", 'Fun Nuggets', ['265 g' => 590]], ["K&N's", 'Chicken Tenders', ['780 g' => 1690]],
                ["K&N's", 'Chapli Kabab', ['296 g' => 590, '888 g' => 1650]], ["K&N's", 'Seekh Kabab', ['205 g' => 560, '540 g' => 1290]],
                ["K&N's", 'Burger Patties', ['540 g' => 1190]], ["K&N's", 'Chicken Samosa', ['240 g' => 520]], ['Sabroso', 'Chicken Nuggets', ['270 g' => 560, '820 g' => 1490]],
                ['Sabroso', 'Tempura', ['235 g' => 590]], ['MonSalwa', 'Plain Paratha', ['5 pcs' => 290, '20 pcs' => 1050]], ['MonSalwa', 'Aloo Paratha', ['5 pcs' => 390]],
                ['Dawn', 'Paratha', ['5 pcs' => 280, '30 pcs' => 1490]], ['Menu', 'Vegetable Samosa', ['12 pcs' => 390]], ['Opa', 'French Fries', ['1 kg' => 590, '2.5 kg' => 1390]],
                ['McCain', 'French Fries', ['750 g' => 690]], ['Fauji', 'Frozen Peas', ['400 g' => 260, '1 kg' => 590]], ['Fauji', 'Frozen Sweet Corn', ['400 g' => 290]],
                ["Wall's", 'Cornetto Chocolate', ['cone' => 150]], ["Wall's", 'Magnum Classic', ['stick' => 290]], ["Wall's", 'Vanilla Tub', ['800 ml' => 690]],
                ["Wall's", 'Chocolate Tub', ['800 ml' => 690]], ['Omoré', 'Mango Tub', ['800 ml' => 650]], ['Omoré', 'Kulfi Stick', ['stick' => 100]],
            ],
            'Cleaning & Laundry' => [
                ['Surf Excel', 'Washing Powder', ['500 g' => 320, '1 kg' => 620, '2 kg' => 1190]], ['Ariel', 'Washing Powder', ['500 g' => 330, '1 kg' => 640, '2 kg' => 1230]],
                ['Bonus', 'Tristar', ['1 kg' => 380, '2 kg' => 740]], ['Express', 'Power', ['1 kg' => 430, '2 kg' => 830]], ['Brite', 'Maximum Power', ['1 kg' => 560, '2 kg' => 1090]],
                ['Rin', 'Detergent Bar', ['bar' => 60]], ['Comfort', 'Fabric Softener', ['400 ml' => 390, '800 ml' => 720]], ['Lemon Max', 'Dish Bar', ['bar' => 50, 'long bar' => 110]],
                ['Lemon Max', 'Dishwash Liquid', ['275 ml' => 190, '475 ml' => 320, '750 ml' => 480]], ['Vim', 'Dishwash Bar', ['long bar' => 110]],
                ['Vim', 'Dishwash Liquid', ['500 ml' => 340]], ['Harpic', 'Toilet Cleaner', ['500 ml' => 390, '1 L' => 690]], ['Dettol', 'Surface Cleaner', ['500 ml' => 490, '1 L' => 890]],
                ['Finis', 'Phenyl', ['1 L' => 290, '2.75 L' => 690]], ['Robin', 'Liquid Bleach', ['500 ml' => 190, '1 L' => 340]], ['Colin', 'Glass Cleaner', ['500 ml' => 420]],
                ['Mortein', 'Insect Killer Spray', ['300 ml' => 490, '600 ml' => 890]], ['Kingtox', 'Insect Killer', ['300 ml' => 450]], ['Mortein', 'Mosquito Coil (10)', ['pack' => 120]],
                ['Scotch-Brite', 'Scrub Sponge', ['pack of 3' => 190]], ['', 'Floor Mop', ['each' => 590]], ['', 'Dusting Cloth (3)', ['pack' => 190]],
            ],
            'Personal Care' => [
                ['Lux', 'Soap', ['98 g' => 110, '140 g' => 150]], ['Lifebuoy', 'Soap', ['98 g' => 100, '140 g' => 140]], ['Dettol', 'Soap', ['85 g' => 120, '130 g' => 170]],
                ['Safeguard', 'Soap', ['100 g' => 120, '135 g' => 160]], ['Capri', 'Soap', ['120 g' => 130]], ['Palmolive', 'Soap', ['135 g' => 150]],
                ['Dove', 'Beauty Bar', ['135 g' => 390]], ['Sunsilk', 'Shampoo Black Shine', ['185 ml' => 390, '360 ml' => 720]],
                ['Sunsilk', 'Shampoo Thick & Long', ['185 ml' => 390, '360 ml' => 720]], ['Head & Shoulders', 'Shampoo', ['185 ml' => 520, '360 ml' => 950]],
                ['Pantene', 'Shampoo', ['185 ml' => 490, '360 ml' => 890]], ['Dove', 'Shampoo', ['175 ml' => 520, '355 ml' => 950]], ['Lifebuoy', 'Shampoo', ['175 ml' => 320, '375 ml' => 590]],
                ['Colgate', 'Toothpaste', ['75 g' => 190, '150 g' => 340]], ['Sensodyne', 'Toothpaste', ['100 g' => 590]], ['Close-Up', 'Toothpaste', ['80 g' => 180, '160 g' => 320]],
                ['Medicam', 'Toothpaste', ['100 g' => 180]], ['Colgate', 'Toothbrush', ['each' => 150]], ['Oral-B', 'Toothbrush', ['each' => 220]],
                ['Glow & Lovely', 'Cream', ['25 g' => 190, '50 g' => 350]], ["Pond's", 'Cold Cream', ['50 ml' => 290]], ['Vaseline', 'Body Lotion', ['100 ml' => 340, '200 ml' => 620]],
                ['Nivea', 'Soft Cream', ['50 ml' => 320, '100 ml' => 560]], ['Gillette', 'Blue II Razors (5)', ['pack' => 390]], ['Treet', 'Razors (5)', ['pack' => 190]],
                ['Gillette', 'Shaving Foam', ['200 ml' => 690]], ['Rexona', 'Deodorant', ['150 ml' => 590]], ['Nivea', 'Deodorant', ['150 ml' => 620]],
                ['Always', 'Ultra Pads (8)', ['pack' => 290]], ['Always', 'Maxi Pads (9)', ['pack' => 250]], ['Dettol', 'Hand Wash', ['250 ml' => 390]],
                ['Lifebuoy', 'Hand Wash', ['200 ml' => 320]], ['Bio Amla', 'Hair Oil', ['100 ml' => 290, '200 ml' => 540]], ['Dabur', 'Amla Hair Oil', ['180 ml' => 520]],
            ],
            'Tissue & Household' => [
                ['Rose Petal', 'Tissue Box', ['regular' => 190, 'family' => 290]], ['Fay', 'Tissue Box', ['regular' => 180, 'family' => 280]],
                ['Tulip', 'Toilet Roll', ['2 rolls' => 190, '4 rolls' => 360, '10 rolls' => 850]], ['Rose Petal', 'Kitchen Towel', ['2 rolls' => 390]],
                ['Diamond', 'Aluminium Foil', ['25 sq ft' => 290, '75 sq ft' => 690]], ['Diamond', 'Cling Film', ['100 ft' => 320]],
                ['', 'Garbage Bags (30)', ['medium' => 220, 'large' => 320]], ['', 'Zip Lock Bags (25)', ['pack' => 290]], ['Tapal', 'Matchbox (10)', ['pack' => 60]],
                ['Osaka', 'AA Batteries (4)', ['pack' => 290]], ['Osaka', 'AAA Batteries (4)', ['pack' => 290]], ['Philips', 'LED Bulb', ['12 W' => 390, '18 W' => 520]],
            ],
            'Baby Care' => [
                ['Pampers', 'Diapers Small', ['pack of 36' => 1490]], ['Pampers', 'Diapers Medium', ['pack of 34' => 1590]], ['Pampers', 'Diapers Large', ['pack of 30' => 1650]],
                ['Pampers', 'Diapers XL', ['pack of 26' => 1690]], ['Molfix', 'Diapers Medium', ['pack of 34' => 1390]], ['Molfix', 'Diapers Large', ['pack of 30' => 1450]],
                ['Canbebe', 'Diapers Medium', ['pack of 34' => 1290]], ['Nestlé', 'Cerelac Wheat', ['175 g' => 390, '350 g' => 720]], ['Nestlé', 'Cerelac Rice', ['175 g' => 390]],
                ['Nestlé', 'Cerelac 3 Fruits', ['175 g' => 420, '350 g' => 780]], ['Nestlé', 'Lactogen 1', ['400 g' => 1590]], ['Nestlé', 'Lactogen 2', ['400 g' => 1590]],
                ['Nido', '1+', ['400 g' => 1190, '900 g' => 2490]], ['Nido', '3+', ['400 g' => 1190]], ["Johnson's", 'Baby Powder', ['100 g' => 290, '200 g' => 520]],
                ["Johnson's", 'Baby Lotion', ['100 ml' => 390, '200 ml' => 690]], ["Johnson's", 'Baby Shampoo', ['100 ml' => 390, '200 ml' => 690]],
                ["Johnson's", 'Baby Oil', ['100 ml' => 420]], ['Pampers', 'Baby Wipes (64)', ['pack' => 490]], ["Johnson's", 'Baby Wipes (72)', ['pack' => 520]],
            ],
            'Fruit & Vegetables' => [
                ['', 'Potato', ['per kg' => 90]], ['', 'Onion', ['per kg' => 140]], ['', 'Tomato', ['per kg' => 160]], ['', 'Garlic', ['per kg' => 520]],
                ['', 'Ginger', ['per kg' => 690]], ['', 'Green Chilli', ['per kg' => 280]], ['', 'Lemon', ['per kg' => 320]], ['', 'Cucumber', ['per kg' => 120]],
                ['', 'Carrot', ['per kg' => 110]], ['', 'Cabbage', ['per kg' => 100]], ['', 'Cauliflower', ['per kg' => 140]], ['', 'Bhindi', ['per kg' => 220]],
                ['', 'Capsicum', ['per kg' => 290]], ['', 'Spinach', ['per kg' => 90]], ['', 'Apple (Kala Kullu)', ['per kg' => 320]], ['', 'Banana', ['per dozen' => 190]],
                ['', 'Orange (Kinnow)', ['per dozen' => 260]], ['', 'Mango (Chaunsa)', ['per kg' => 290]], ['', 'Grapes', ['per kg' => 420]], ['', 'Guava', ['per kg' => 180]],
                ['', 'Pomegranate', ['per kg' => 520]], ['', 'Watermelon', ['per kg' => 80]],
            ],
            'Loose & Weighed' => [
                ['', 'Sugar', ['per kg' => 160]], ['', 'Gur (Jaggery)', ['per kg' => 240]], ['', 'Basmati Rice (Loose)', ['per kg' => 380]],
                ['', 'Broken Rice (Tota)', ['per kg' => 210]], ['', 'Almonds', ['per kg' => 2890]], ['', 'Walnuts', ['per kg' => 1990]], ['', 'Cashews', ['per kg' => 3490]],
                ['', 'Pistachios', ['per kg' => 4290]], ['', 'Raisins (Kishmish)', ['per kg' => 1190]], ['', 'Dates (Khajoor)', ['per kg' => 690]],
                ['', 'Peanuts', ['per kg' => 620]], ['', 'Chicken (Whole)', ['per kg' => 590]], ['', 'Chicken Boneless', ['per kg' => 990]],
                ['', 'Beef (Boneless)', ['per kg' => 1490]], ['', 'Mutton', ['per kg' => 2390]], ['', 'Beef Qeema', ['per kg' => 1390]],
            ],
        ];
    }

    /**
     * Every pack on every shelf, one line each.
     *
     * @return array<int, array{category: string, name: string, price: int, brand: ?string, by_weight: bool}>
     */
    public static function lines(): array
    {
        $out = [];
        foreach (self::aisles() as $aisle => $families) {
            $weighed = in_array($aisle, self::WEIGHED, true);
            foreach ($families as [$brand, $product, $sizes]) {
                foreach ($sizes as $size => $price) {
                    // "per kg" is how it is sold, not part of what it is called.
                    $suffix = str_starts_with((string) $size, 'per ') || count($sizes) === 1 && in_array($size, ['each', 'pack', 'box', 'bar', 'cone', 'stick'], true)
                        ? ''
                        : ' '.$size;
                    $out[] = [
                        'category' => $aisle,
                        'name' => trim(trim("{$brand} {$product}").$suffix),
                        'price' => $price,
                        'brand' => $brand !== '' ? $brand : null,
                        'by_weight' => $weighed && str_contains((string) $size, 'kg'),
                    ];
                }
            }
        }

        return $out;
    }
}
