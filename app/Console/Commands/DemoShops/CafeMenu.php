<?php

namespace App\Console\Commands\DemoShops;

use App\Console\Commands\SeedDemoShops;

/**
 * A café-restaurant's menu, the way one in Lahore is actually written.
 *
 * Section by section, in the order a menu card runs: breakfast first, the
 * kitchen's mains, then the bakery counter and the bar. Prices are rupees and
 * are in the range a mid-market place in Johar Town charges — near enough that
 * a restaurateur looking at the demo does not stop on one.
 *
 * `STATIONS` says where each section is cooked, which is what splits a fired
 * order into one ticket per station.
 *
 * @see SeedDemoShops
 */
final class CafeMenu
{
    /** section => the station that makes it */
    public const STATIONS = [
        'Breakfast' => 'Hot Kitchen', 'Soups' => 'Hot Kitchen', 'Salads' => 'Pantry', 'Starters' => 'Fryer',
        'BBQ' => 'Grill', 'Karahi & Handi' => 'Hot Kitchen', 'Biryani & Rice' => 'Hot Kitchen', 'Tandoor' => 'Tandoor',
        'Burgers' => 'Grill', 'Sandwiches & Wraps' => 'Pantry', 'Pizza' => 'Pizza Oven', 'Pasta' => 'Hot Kitchen',
        'Chinese' => 'Hot Kitchen', 'Steaks & Grill' => 'Grill', 'Seafood' => 'Fryer', 'Sides & Dips' => 'Pantry',
        'Desserts' => 'Pantry', 'Cakes & Bakery' => 'Bakery', 'Ice Cream' => 'Bar', 'Hot Coffee' => 'Bar',
        'Iced Coffee & Frappés' => 'Bar', 'Tea & Chai' => 'Bar', 'Fresh Juices' => 'Bar', 'Shakes & Smoothies' => 'Bar',
        'Mocktails & Coolers' => 'Bar', 'Soft Drinks & Water' => 'Bar', 'Kids Menu' => 'Fryer', 'Deals & Platters' => 'Hot Kitchen',
    ];

    /** @return array<string, array<string, int>> section => [dish => rupees] */
    public static function sections(): array
    {
        $sections = [
            'Karahi & Handi' => [
                'Chicken Karahi (Half)' => 990, 'Chicken Karahi (Full)' => 1890, 'Chicken White Karahi (Half)' => 1090, 'Chicken White Karahi (Full)' => 2090,
                'Mutton Karahi (Half)' => 2190, 'Mutton Karahi (Full)' => 4190, 'Mutton White Karahi (Half)' => 2290, 'Mutton White Karahi (Full)' => 4390,
                'Beef Karahi (Half)' => 1490, 'Beef Karahi (Full)' => 2790, 'Chicken Makhni Handi' => 1190, 'Chicken Achari Handi' => 1150,
                'Chicken Boneless Handi' => 1290, 'Chicken Jalfrezi' => 1090, 'Chicken Ginger' => 1090, 'Chicken Tikka Masala' => 1150,
                'Butter Chicken' => 1190, 'Mutton Handi' => 2390, 'Mutton Kunna' => 2490, 'Mutton Qorma' => 2190, 'Chicken Qorma' => 990,
                'Beef Nihari' => 890, 'Special Nalli Nihari' => 1190, 'Haleem' => 590, 'Paya' => 890, 'Daal Makhani' => 590, 'Daal Mash' => 490,
                'Daal Chana' => 450, 'Mix Vegetable' => 490, 'Palak Paneer' => 690, 'Shahi Paneer' => 720, 'Aloo Gobi' => 450,
                'Bhindi Masala' => 490, 'Chana Masala' => 450, 'Aloo Keema' => 790, 'Beef Qeema' => 850, 'Brain Masala' => 990, 'Chicken Shashlik' => 1090,
            ],
            'BBQ' => [
                'Chicken Tikka (Leg)' => 420, 'Chicken Tikka (Chest)' => 450, 'Malai Boti (10 pcs)' => 790, 'Chicken Boti (10 pcs)' => 690,
                'Reshmi Kebab (4 pcs)' => 720, 'Beef Seekh Kebab (4 pcs)' => 760, 'Chicken Seekh Kebab (4 pcs)' => 680, 'Mutton Seekh Kebab (4 pcs)' => 990,
                'Gola Kebab' => 790, 'Chapli Kebab (2 pcs)' => 520, 'Behari Kebab' => 890, 'Behari Boti' => 920, 'Mutton Chops (4 pcs)' => 1490,
                'Beef Boti' => 820, 'Fish Tikka' => 1190, 'Tandoori Prawns' => 1490, 'Chicken Cheese Kebab' => 790, 'Kastoori Boti' => 820,
                'Achari Boti' => 720, 'Green Chicken Boti' => 740, 'Afghani Tikka' => 760, 'Namkeen Boti' => 890, 'Dhaga Kebab' => 840,
                'Turkish Kebab' => 990, 'Lamb Chops' => 2290, 'BBQ Platter for Two' => 2490, 'BBQ Platter for Four' => 4690, 'Mix Grill Platter' => 3290,
            ],
            'Biryani & Rice' => [
                'Chicken Biryani' => 490, 'Beef Biryani' => 590, 'Mutton Biryani' => 890, 'Sindhi Biryani' => 550, 'Hyderabadi Dum Biryani' => 620,
                'Prawn Biryani' => 990, 'Vegetable Biryani' => 390, 'Chicken Biryani Family (1 kg)' => 1690, 'Chicken Pulao' => 450, 'Beef Yakhni Pulao' => 590,
                'Kabuli Pulao' => 890, 'Mutton Pulao' => 890, 'Matar Pulao' => 320, 'Plain Rice' => 220, 'Zeera Rice' => 260, 'Garlic Rice' => 320,
                'Egg Fried Rice' => 420, 'Chicken Fried Rice' => 520, 'Vegetable Fried Rice' => 390, 'Prawn Fried Rice' => 790, 'Masala Rice' => 340, 'Singaporean Rice' => 720,
            ],
            'Burgers' => [
                'Zinger Burger' => 520, 'Zinger Supreme' => 620, 'Mighty Zinger' => 820, 'Classic Beef Burger' => 690, 'Cheese Burger' => 740,
                'Double Beef Burger' => 990, 'Smash Burger' => 790, 'Double Smash Burger' => 1090, 'Mushroom Swiss Burger' => 890, 'Jalapeño Beef Burger' => 840,
                'BBQ Beef Burger' => 920, 'Smoky Jack Burger' => 960, 'Pulled Beef Burger' => 990, 'Crispy Chicken Burger' => 490, 'Grilled Chicken Burger' => 590,
                'Chicken Tikka Burger' => 560, 'Peri Peri Chicken Burger' => 640, 'Nashville Hot Chicken Burger' => 790, 'Tower Burger' => 890, 'Fish Burger' => 620,
                'Chapli Burger' => 540, 'Anda Shami Burger' => 320, 'Bun Kebab' => 260, 'Chicken Patty Burger' => 340, 'Veggie Burger' => 450, 'Junior Burger' => 390,
            ],
            'Pizza' => [],
            'Chinese' => [
                'Chicken Chowmein' => 690, 'Beef Chowmein' => 790, 'Vegetable Chowmein' => 590, 'Prawn Chowmein' => 990, 'Chicken Manchurian' => 890,
                'Chicken Chilli Dry' => 920, 'Kung Pao Chicken' => 940, 'Chicken Szechuan' => 920, 'Sweet & Sour Chicken' => 890, 'Black Pepper Chicken' => 920,
                'Chicken Cashew Nut' => 990, 'Chicken with Almonds' => 990, 'Chicken in Oyster Sauce' => 920, 'Lemon Chicken' => 920, 'Honey Chicken' => 940,
                'Thai Chicken' => 940, 'Chicken Hot Plate' => 1190, 'Beef Chilli Dry' => 1090, 'Beef with Black Pepper' => 1090, 'Mongolian Beef' => 1140,
                'Beef in Oyster Sauce' => 1090, 'Crispy Beef' => 1140, 'Sweet & Sour Prawns' => 1390, 'Prawn Chilli Dry' => 1420, 'Hot Garlic Prawns' => 1390,
                'Fish Chilli Dry' => 1190, 'Vegetable Manchurian' => 690, 'Chicken Drumsticks (6 pcs)' => 720,
            ],
            'Steaks & Grill' => [
                'Chicken Steak with Mushroom Sauce' => 1190, 'Chicken Steak with Pepper Sauce' => 1190, 'Tarragon Chicken' => 1240, 'Mexican Chicken Steak' => 1240,
                'Moroccan Chicken' => 1240, 'Chicken Parmesan' => 1290, 'Chicken Cordon Bleu' => 1390, 'Stuffed Chicken' => 1340, 'Peri Peri Chicken (Half)' => 1190,
                'Beef Steak with Mushroom Sauce' => 1890, 'Pepper Steak' => 1890, 'Beef Tenderloin' => 2990, 'T-Bone Steak' => 2890, 'Rib Eye Steak' => 3290,
                'Fillet Mignon' => 3490, 'Lamb Shank' => 2690, 'Grilled Fish with Lemon Butter' => 1490, 'Grilled Salmon' => 3290,
            ],
            'Pasta' => [
                'Fettuccine Alfredo' => 790, 'Chicken Alfredo' => 890, 'Prawn Alfredo' => 1190, 'Penne Arrabbiata' => 690, 'Spaghetti Bolognese' => 840,
                'Carbonara' => 890, 'Chicken Lasagna' => 890, 'Beef Lasagna' => 940, 'Mac & Cheese' => 620, 'Creamy Mushroom Pasta' => 820,
                'Pesto Chicken Pasta' => 890, 'Spicy Chicken Penne' => 820, 'Baked Ziti' => 840, 'Pink Sauce Pasta' => 820, 'Chicken Tikka Pasta' => 790,
                'Four Cheese Pasta' => 920, 'Cajun Chicken Pasta' => 890, 'Seafood Marinara' => 1290,
            ],
            'Seafood' => [
                'Fried Fish (250 g)' => 890, 'Lahori Fried Fish (1 kg)' => 2890, 'Grilled Fish Fillet' => 1490, 'Fish & Chips' => 990, 'Fish Karahi' => 1590,
                'Fish Curry' => 1290, 'Prawn Karahi' => 1890, 'Prawn Masala' => 1790, 'Garlic Butter Prawns' => 1690, 'Crispy Calamari' => 1090,
                'Tempura Platter' => 1790, 'Seafood Platter' => 3490,
            ],
            'Starters' => [
                'Chicken Wings (6 pcs)' => 620, 'BBQ Wings' => 650, 'Buffalo Wings' => 650, 'Honey Mustard Wings' => 680, 'Dynamite Chicken' => 720,
                'Dynamite Prawns' => 990, 'Chicken Tenders' => 590, 'Fish Fingers' => 690, 'Finger Fish' => 890, 'Prawn Tempura' => 1090,
                'Mozzarella Sticks' => 620, 'Onion Rings' => 320, 'Plain Fries' => 260, 'Masala Fries' => 320, 'Curly Fries' => 340, 'Cheese Fries' => 420,
                'Loaded Fries' => 520, 'Potato Wedges' => 340, 'Garlic Bread' => 280, 'Cheese Garlic Bread' => 380, 'Bruschetta' => 440,
                'Chicken Samosa (4 pcs)' => 280, 'Vegetable Spring Rolls' => 320, 'Chicken Spring Rolls' => 380, 'Nachos with Cheese' => 590,
                'Chicken Nachos' => 720, 'Hummus with Pita' => 480, 'Stuffed Mushrooms' => 560,
            ],
            'Sandwiches & Wraps' => [
                'Club Sandwich' => 590, 'Chicken Club Sandwich' => 640, 'Grilled Chicken Sandwich' => 590, 'Chicken Tikka Sandwich' => 560, 'BBQ Chicken Sandwich' => 590,
                'Chicken Mayo Sandwich' => 420, 'Egg Mayo Sandwich' => 380, 'Tuna Sandwich' => 620, 'Cheese Toast' => 320, 'Chicken Panini' => 720,
                'Beef Steak Sandwich' => 890, 'Philly Cheese Steak' => 990, 'Chicken Shawarma' => 380, 'Beef Shawarma' => 450, 'Shawarma Platter' => 720,
                'Chicken Paratha Roll' => 340, 'Beef Paratha Roll' => 390, 'Malai Boti Roll' => 420, 'Behari Roll' => 450, 'Reshmi Kebab Roll' => 420,
                'Mayo Garlic Roll' => 380, 'Chatni Roll' => 320, 'Cheese Roll' => 450, 'Zinger Wrap' => 490, 'Grilled Chicken Wrap' => 540,
                'Chicken Caesar Wrap' => 590, 'Chicken Fajita Wrap' => 620, 'Falafel Wrap' => 440, 'Chicken Quesadilla' => 690, 'Beef Quesadilla' => 790,
            ],
            'Breakfast' => [
                'Halwa Puri' => 450, 'Anda Paratha' => 320, 'Aloo Paratha' => 280, 'Chicken Cheese Paratha' => 480, 'Lachha Paratha' => 120,
                'Plain Omelette' => 220, 'Cheese Omelette' => 320, 'Spanish Omelette' => 380, 'Masala Omelette' => 260, 'French Toast' => 420,
                'Pancakes with Maple Syrup' => 520, 'Nutella Pancakes' => 620, 'Belgian Waffle' => 580, 'Nutella Waffle' => 680, 'English Breakfast' => 890,
                'Desi Nashta Platter' => 790, 'Channay' => 260, 'Nihari Nashta' => 720, 'Eggs Benedict' => 690, 'Avocado Toast' => 720, 'Shakshuka' => 640, 'Granola Bowl' => 560,
            ],
            'Soups' => [
                'Chicken Corn Soup' => 320, 'Hot & Sour Soup' => 340, 'Thai Soup' => 420, 'Szechuan Soup' => 380, 'Wonton Soup' => 440, 'Cream of Mushroom' => 390,
                'Cream of Chicken' => 380, 'Tomato Basil Soup' => 340, 'Lentil Soup' => 280, 'Chicken Yakhni' => 300, 'Seafood Chowder' => 620, 'House Special Soup' => 450,
            ],
            'Salads' => [
                'Caesar Salad' => 590, 'Chicken Caesar Salad' => 720, 'Greek Salad' => 620, 'Russian Salad' => 420, 'Fresh Garden Salad' => 350,
                'Kachumber Salad' => 180, 'Fattoush' => 520, 'Chicken Tikka Salad' => 680, 'Thai Beef Salad' => 820, 'Quinoa Salad' => 760,
                'Waldorf Salad' => 620, 'Pasta Salad' => 540, 'Coleslaw' => 180, 'Plain Raita' => 150, 'Mint Raita' => 160, 'Zeera Raita' => 160,
            ],
            'Tandoor' => [
                'Roti' => 30, 'Chapati' => 30, 'Khameeri Roti' => 50, 'Naan' => 60, 'Roghni Naan' => 90, 'Butter Naan' => 100, 'Kalonji Naan' => 100,
                'Garlic Naan' => 120, 'Aloo Naan' => 180, 'Cheese Naan' => 320, 'Qeema Naan' => 380, 'Chicken Cheese Naan' => 420, 'Peshawari Naan' => 260,
                'Tandoori Paratha' => 110, 'Taftan' => 140, 'Sheermal' => 160, 'Missi Roti' => 80, 'Puri' => 50,
            ],
            'Sides & Dips' => [
                'Garlic Mayo Dip' => 80, 'BBQ Dip' => 80, 'Chilli Garlic Dip' => 80, 'Honey Mustard Dip' => 90, 'Tartar Sauce' => 90, 'Cheese Dip' => 120,
                'Green Chutney' => 50, 'Imli Chutney' => 50, 'Achar' => 40, 'Papad' => 40, 'Extra Cheese Slice' => 90, 'Sautéed Vegetables' => 290,
                'Mashed Potato' => 290, 'Baked Potato' => 320, 'Corn on the Cob' => 220, 'Steamed Rice' => 220,
            ],
            'Kids Menu' => [
                'Kids Chicken Nuggets (6 pcs)' => 390, 'Kids Mini Burger' => 390, 'Kids Mac & Cheese' => 420, 'Kids Pizza' => 490, 'Kids Fish Fingers' => 450,
                'Kids Pasta' => 420, 'Kids Fries & Tenders' => 450, 'Kids Pancakes' => 380, 'Kids Milkshake' => 320, 'Kids Fruit Cup' => 260,
            ],
            'Deals & Platters' => [
                'Lunch Deal — Burger, Fries & Drink' => 790, 'Student Deal' => 590, 'Office Lunch Box' => 690, 'Coffee & Cake Deal' => 790, 'Midnight Deal' => 990,
                'Breakfast for Two' => 1490, 'Hi-Tea Platter for Two' => 1890, 'Pizza Party Deal' => 2990, 'BBQ Night Deal' => 2990, 'Karahi Family Deal' => 3490,
                'Family Feast for Four' => 4490, 'Kids Party Pack' => 2490,
            ],
            'Desserts' => [
                'Gulab Jamun (2 pcs)' => 180, 'Ras Malai (2 pcs)' => 260, 'Kheer' => 240, 'Firni' => 220, 'Gajar Halwa' => 320, 'Suji Halwa' => 220,
                'Shahi Tukra' => 340, 'Zarda' => 240, 'Kulfi' => 220, 'Falooda' => 390, 'Rabri' => 290, 'Jalebi (250 g)' => 260, 'Chocolate Lava Cake' => 590,
                'Molten Brownie with Ice Cream' => 620, 'Walnut Brownie' => 320, 'Tiramisu' => 640, 'New York Cheesecake' => 620, 'Lotus Cheesecake' => 690,
                'Blueberry Cheesecake' => 660, 'Three Milk Cake' => 520, 'Crème Brûlée' => 590, 'Apple Pie' => 520, 'Banoffee Pie' => 560, 'Chocolate Mousse' => 490,
                'Fruit Trifle' => 380, 'Caramel Custard' => 320, 'Churros with Chocolate' => 520, 'Cookie Skillet' => 640,
            ],
            'Cakes & Bakery' => [
                'Chocolate Fudge Cake (Slice)' => 420, 'Red Velvet Cake (Slice)' => 450, 'Black Forest Cake (Slice)' => 390, 'Pineapple Cake (Slice)' => 360,
                'Coffee Cake (Slice)' => 390, 'Carrot Cake (Slice)' => 420, 'Chocolate Fudge Cake (2 lb)' => 2890, 'Red Velvet Cake (2 lb)' => 3190,
                'Black Forest Cake (2 lb)' => 2690, 'Pineapple Cake (2 lb)' => 2490, 'Butter Croissant' => 280, 'Chocolate Croissant' => 340, 'Almond Croissant' => 380,
                'Cheese Croissant' => 340, 'Chicken Patty' => 160, 'Vegetable Patty' => 120, 'Chicken Puff' => 180, 'Cinnamon Roll' => 320, 'Blueberry Muffin' => 290,
                'Chocolate Muffin' => 290, 'Banana Bread (Slice)' => 260, 'Chocolate Chip Cookie' => 180, 'Oatmeal Cookie' => 180, 'Double Chocolate Cookie' => 200,
                'Glazed Donut' => 180, 'Chocolate Donut' => 200, 'Nutella Donut' => 260, 'Chocolate Eclair' => 240, 'Fruit Tart' => 320, 'Lemon Tart' => 320,
                'Cake Rusk (Pack)' => 380, 'Bakarkhani (Pack)' => 320,
            ],
            'Ice Cream' => [
                'Vanilla Scoop' => 190, 'Chocolate Scoop' => 190, 'Strawberry Scoop' => 190, 'Tutti Frutti Scoop' => 190, 'Mango Scoop' => 210, 'Kulfa Scoop' => 210,
                'Pistachio Scoop' => 230, 'Cookies & Cream Scoop' => 230, 'Praline Scoop' => 230, 'Chocolate Sundae' => 420, 'Caramel Sundae' => 420,
                'Banana Split' => 590, 'Ice Cream Waffle Bowl' => 490, 'Affogato' => 420,
            ],
            'Hot Coffee' => ['Espresso' => 320, 'Double Espresso' => 390, 'Macchiato' => 380, 'Cortado' => 420, 'Flat White' => 480, 'Turkish Coffee' => 420, 'French Press' => 520],
            'Iced Coffee & Frappés' => [
                'Iced Americano' => 450, 'Iced Latte' => 520, 'Iced Cappuccino' => 520, 'Iced Mocha' => 590, 'Iced White Mocha' => 610, 'Iced Caramel Macchiato' => 630,
                'Iced Spanish Latte' => 650, 'Iced Hazelnut Latte' => 610, 'Iced Vanilla Latte' => 610, 'Iced Pistachio Latte' => 690, 'Iced Shaken Espresso' => 560,
                'Iced Matcha Latte' => 690, 'Cold Brew' => 520, 'Vanilla Cold Brew' => 580, 'Nitro Cold Brew' => 620, 'Coffee Frappé' => 660, 'Vanilla Frappé' => 660,
                'Caramel Frappé' => 690, 'Mocha Frappé' => 690, 'Hazelnut Frappé' => 690, 'Java Chip Frappé' => 740, 'Oreo Frappé' => 740, 'Lotus Frappé' => 760,
                'Affogato Shake' => 620,
            ],
            'Tea & Chai' => [
                'Doodh Patti' => 150, 'Karak Chai' => 180, 'Elaichi Chai' => 170, 'Adrak Chai' => 170, 'Masala Chai' => 190, 'Gur Wali Chai' => 190,
                'Tandoori Chai' => 220, 'Kashmiri Chai' => 260, 'Green Tea' => 160, 'Peshawari Kahwa' => 180, 'Lemon Tea' => 160, 'Mint Tea' => 170,
                'English Breakfast Tea' => 260, 'Earl Grey' => 260, 'Chamomile Tea' => 280, 'Jasmine Tea' => 280, 'Chai Latte' => 480, 'Matcha Latte' => 620,
                'Iced Lemon Tea' => 320, 'Iced Peach Tea' => 360,
            ],
            'Fresh Juices' => [
                'Orange Juice' => 420, 'Apple Juice' => 420, 'Carrot Juice' => 320, 'Pomegranate Juice' => 590, 'Mango Juice' => 420, 'Pineapple Juice' => 420,
                'Watermelon Juice' => 320, 'Grapefruit Juice' => 420, 'Mosambi Juice' => 380, 'Sugarcane Juice' => 180, 'Falsa Juice' => 320, 'Strawberry Juice' => 450,
                'Peach Juice' => 420, 'Mix Fruit Juice' => 480, 'ABC Detox Juice' => 490, 'Green Detox Juice' => 520, 'Lemonade' => 250, 'Mint Lemonade' => 290,
                'Mint Margarita' => 350, 'Pina Colada' => 480, 'Sweet Lassi' => 250, 'Salted Lassi' => 250, 'Mango Lassi' => 350,
            ],
            'Shakes & Smoothies' => [
                'Chocolate Shake' => 520, 'Vanilla Shake' => 480, 'Strawberry Shake' => 520, 'Mango Shake' => 520, 'Banana Shake' => 450, 'Oreo Shake' => 590,
                'KitKat Shake' => 620, 'Lotus Biscoff Shake' => 690, 'Nutella Shake' => 690, 'Peanut Butter Shake' => 620, 'Date Shake' => 520, 'Pistachio Shake' => 620,
                'Coffee Shake' => 560, 'Caramel Shake' => 560, 'Brownie Shake' => 660, 'Avocado Shake' => 690, 'Protein Shake' => 720, 'Berry Blast Smoothie' => 620,
                'Mango Smoothie' => 590, 'Strawberry Banana Smoothie' => 620, 'Tropical Smoothie' => 620,
            ],
            'Mocktails & Coolers' => [
                'Blue Lagoon' => 420, 'Virgin Mojito' => 420, 'Strawberry Mojito' => 460, 'Passion Fruit Mojito' => 480, 'Peach Iced Cooler' => 440,
                'Electric Lemonade' => 440, 'Sunrise' => 440, 'Cinderella' => 460, 'Shirley Temple' => 440, 'Fruit Punch' => 460, 'Kiwi Cooler' => 460,
                'Green Apple Cooler' => 440, 'Lychee Cooler' => 460, 'Rose Sharbat Cooler' => 320, 'Imli Aloo Bukhara Sharbat' => 280,
            ],
            'Soft Drinks & Water' => [
                'Coca-Cola Can' => 150, 'Coke Zero Can' => 150, 'Sprite Can' => 150, 'Fanta Can' => 150, 'Pepsi Can' => 150, '7UP Can' => 150, 'Mirinda Can' => 150,
                'Mountain Dew Can' => 150, 'Coca-Cola 500 ml' => 130, 'Sprite 500 ml' => 130, 'Coca-Cola 1.5 L' => 250, 'Pepsi 1.5 L' => 250, 'Sting' => 180,
                'Red Bull' => 590, 'Mineral Water (Small)' => 80, 'Mineral Water (Large)' => 140, 'Sparkling Water' => 320, 'Fresh Lime Soda' => 250,
            ],
        ];

        // A pizza comes in three sizes, and a menu prints all three.
        $flavours = [
            'Margherita' => 590, 'Chicken Tikka' => 690, 'Chicken Fajita' => 690, 'BBQ Chicken' => 690, 'Chicken Supreme' => 740, 'Creamy Tikka' => 740,
            'Malai Boti' => 740, 'Behari Kebab' => 790, 'Pepperoni' => 790, 'Beef Lover' => 790, 'Hot & Spicy' => 690, 'Vegetable Lover' => 620,
            'Cheese Lover' => 690, 'Four Seasons' => 790,
        ];
        foreach ($flavours as $flavour => $small) {
            $sections['Pizza']["{$flavour} Pizza (Small)"] = $small;
            $sections['Pizza']["{$flavour} Pizza (Medium)"] = (int) (round($small * 1.72 / 10) * 10);
            $sections['Pizza']["{$flavour} Pizza (Large)"] = (int) (round($small * 2.45 / 10) * 10);
        }

        // …and the coffee bar pours most things in two.
        $poured = [
            'Americano' => 390, 'Cappuccino' => 450, 'Latte' => 450, 'Mocha' => 520, 'White Mocha' => 540, 'Caramel Macchiato' => 560, 'Spanish Latte' => 580,
            'Hazelnut Latte' => 540, 'Vanilla Latte' => 540, 'Caramel Latte' => 540, 'Cinnamon Latte' => 540, 'Pistachio Latte' => 620,
            'Lotus Biscoff Latte' => 640, 'Hot Chocolate' => 490, 'White Hot Chocolate' => 520,
        ];
        foreach ($poured as $drink => $regular) {
            $sections['Hot Coffee']["{$drink} (Regular)"] = $regular;
            $sections['Hot Coffee']["{$drink} (Large)"] = $regular + 70;
        }

        return $sections;
    }

    /**
     * What a dish is offered with, by the section it is on.
     *
     * @return array{name: string, type: string, min: int, max: int, choices: array<int, array{0: string, 1: int}>}|null
     */
    public static function choiceFor(string $section): ?array
    {
        return match ($section) {
            'Karahi & Handi', 'BBQ', 'Biryani & Rice', 'Chinese' => [
                'name' => 'Spice level', 'type' => 'single', 'min' => 1, 'max' => 1,
                'choices' => [['Mild', 0], ['Medium', 0], ['Spicy', 0]],
            ],
            'Burgers', 'Sandwiches & Wraps' => [
                'name' => 'Add-ons', 'type' => 'multiple', 'min' => 0, 'max' => 3,
                'choices' => [['Extra cheese', 90], ['Jalapeños', 60], ['Extra patty', 320], ['Make it a meal (fries & drink)', 290]],
            ],
            'Pizza' => [
                'name' => 'Crust', 'type' => 'single', 'min' => 1, 'max' => 1,
                'choices' => [['Pan', 0], ['Thin', 0], ['Stuffed crust', 250]],
            ],
            'Steaks & Grill' => [
                'name' => 'How it is done', 'type' => 'single', 'min' => 1, 'max' => 1,
                'choices' => [['Well done', 0], ['Medium well', 0], ['Medium', 0]],
            ],
            'Hot Coffee', 'Iced Coffee & Frappés' => [
                'name' => 'Extras', 'type' => 'multiple', 'min' => 0, 'max' => 3,
                'choices' => [['Extra shot', 120], ['Oat milk', 150], ['Vanilla syrup', 80], ['Caramel syrup', 80], ['Decaf', 0]],
            ],
            'Tea & Chai' => [
                'name' => 'Sugar', 'type' => 'single', 'min' => 1, 'max' => 1,
                'choices' => [['Regular', 0], ['Less sugar', 0], ['No sugar', 0], ['Gur', 20]],
            ],
            'Shakes & Smoothies', 'Ice Cream' => [
                'name' => 'Toppings', 'type' => 'multiple', 'min' => 0, 'max' => 2,
                'choices' => [['Whipped cream', 60], ['Chocolate sauce', 50], ['Crushed nuts', 80]],
            ],
            default => null,
        };
    }
}
