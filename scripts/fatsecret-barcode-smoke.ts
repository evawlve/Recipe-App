import 'dotenv/config';
import { lookupFatSecretBarcode } from '@/lib/fatsecret/barcode';

const barcode = process.argv[2] || '012345678905';

lookupFatSecretBarcode(barcode)
  .then(res => {
    console.log(JSON.stringify(res, null, 2));
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

