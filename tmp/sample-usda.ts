import 'dotenv/config';
import fs from 'fs';

const raw = fs.readFileSync('data/usda/FoodData_Central_sr_legacy_food_json_2018-04.json', 'utf-8');
const data = JSON.parse(raw);
const foods: any[] = data.SRLegacyFoods ?? data.foods ?? data;
console.log('Total SR Legacy foods:', foods.length);

// Sample 40 descriptions spread across the dataset
const step = Math.floor(foods.length / 40);
for (let i = 0; i < foods.length; i += step) {
    const f = foods[i];
    const cat = typeof f.foodCategory === 'string' ? f.foodCategory : f.foodCategory?.description ?? '';
    console.log(JSON.stringify({ desc: f.description, cat, dataType: f.dataType }));
}
