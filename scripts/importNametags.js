// scripts/importNametags.js
const fs = require('fs/promises');
const path = require('path');
const admin = require('firebase-admin');

// Load environment variables
require('dotenv').config();

const NAMETAGS_DIR = process.env.NAMETAGS_DIR || path.resolve(__dirname, '../public/nametags');
const NAMETAGS_COLLECTION = 'nametags';
const ERROR_LOG_FILE = path.resolve(__dirname, 'import_nametags_errors.log');
const BATCH_SIZE = 500; // Firestore batch write limit

// Initialize Firebase Admin SDK
const firebaseConfig = {
  type: 'service_account',
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: process.env.FIREBASE_AUTH_URI,
  token_uri: process.env.FIREBASE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_X509_CERT_URL,
  client_x509_cert_url: process.env.FIREBASE_CLIENT_X509_CERT_URL
};

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(firebaseConfig),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  } catch (error) {
    console.error('Error initializing Firebase Admin SDK:', error.message);
    process.exit(1);
  }
}

const db = admin.firestore();

async function logError(message) {
  try {
    await fs.appendFile(ERROR_LOG_FILE, `${new Date().toISOString()} - ${message}\n`, 'utf8');
  } catch (error) {
    console.error('Error writing to error log:', error.message);
  }
}

async function checkExistingAddresses(addresses) {
  const existingAddresses = new Set();
  const chunks = [];
  for (let i = 0; i < addresses.length; i += 30) { // Firestore 'in' query limit is 30
    chunks.push(addresses.slice(i, i + 30));
  }

  for (const chunk of chunks) {
    try {
      const snapshot = await db.collection(NAMETAGS_COLLECTION)
        .where(admin.firestore.FieldPath.documentId(), 'in', chunk)
        .select() // Select no fields to optimize
        .get();
      snapshot.forEach(doc => existingAddresses.add(doc.id));
    } catch (error) {
      await logError(`Error checking existing addresses for chunk ${chunk.join(', ')}: ${error.message}`);
    }
  }
  return existingAddresses;
}

async function importNametags() {
  console.log(`Starting import of nametags from directory: ${NAMETAGS_DIR}`);
  let totalImported = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  try {
    const files = await fs.readdir(NAMETAGS_DIR);
    const jsonFiles = files.filter(file => file.startsWith('addresses-') && file.endsWith('.json'));

    for (const file of jsonFiles) {
      const filePath = path.join(NAMETAGS_DIR, file);
      console.log(`Processing file: ${filePath}`);

      let jsonData;
      try {
        const fileContent = await fs.readFile(filePath, 'utf8');
        jsonData = JSON.parse(fileContent);
      } catch (error) {
        await logError(`Failed to read or parse file ${file}: ${error.message}`);
        totalErrors++;
        continue;
      }

      const addresses = Object.keys(jsonData).map(addr => addr.toLowerCase());
      const existingAddresses = await checkExistingAddresses(addresses);
      const newAddresses = addresses.filter(addr => !existingAddresses.has(addr));

      if (newAddresses.length === 0) {
        console.log(`  All addresses in ${file} already exist in Firestore. Skipping.`);
        totalSkipped += addresses.length;
        continue;
      }

      console.log(`  Found ${newAddresses.length} new addresses to import from ${file}`);

      let batch = db.batch();
      let batchCount = 0;

      for (const address of newAddresses) {
        const nametag = jsonData[address];
        const normalizedAddress = address.toLowerCase();

        // Validate nametag
        if (!nametag || typeof nametag !== 'object') {
          await logError(`Invalid nametag data for address ${normalizedAddress} in ${file}: nametag is ${nametag}`);
          totalErrors++;
          continue;
        }

        // Validate and normalize Labels
        const labels = nametag.Labels || {
          'deposit': {
            'Name Tag': 'Unknown',
            'Description': 'No specific label information.',
            'Subcategory': 'Deposit',
            'image': '/icons/default.png'
          }
        };
        if (Object.keys(labels).length > 0) {
          const firstLabelKey = Object.keys(labels)[0];
          labels[firstLabelKey].image = labels[firstLabelKey].image || '/icons/default.png';
        }

        const firestoreDocument = {
          Labels: labels,
          Address: nametag.Address || normalizedAddress,
          last_updated: new Date().toISOString()
        };

        try {
          const docRef = db.collection(NAMETAGS_COLLECTION).doc(normalizedAddress);
          batch.set(docRef, firestoreDocument, { merge: true });
          batchCount++;
          totalImported++;
        } catch (error) {
          await logError(`Failed to add address ${normalizedAddress} from ${file} to batch: ${error.message}`);
          totalErrors++;
          continue;
        }

        if (batchCount >= BATCH_SIZE) {
          try {
            await batch.commit();
            console.log(`  Committed batch of ${batchCount} nametags from ${file}`);
            batch = db.batch();
            batchCount = 0;
          } catch (error) {
            await logError(`Failed to commit batch for ${file}: ${error.message}`);
            totalErrors++;
          }
        }
      }

      if (batchCount > 0) {
        try {
          await batch.commit();
          console.log(`  Committed final batch of ${batchCount} nametags from ${file}`);
        } catch (error) {
          await logError(`Failed to commit final batch for ${file}: ${error.message}`);
          totalErrors++;
        }
      }

      totalSkipped += (addresses.length - newAddresses.length);
    }

    console.log(`\nImport completed!`);
    console.log(`Total nametags imported: ${totalImported}`);
    console.log(`Total nametags skipped (already exist): ${totalSkipped}`);
    console.log(`Total errors: ${totalErrors}`);
    if (totalErrors > 0) {
      console.log(`Check error log at ${ERROR_LOG_FILE} for details`);
    }
  } catch (error) {
    await logError(`Error processing directory ${NAMETAGS_DIR}: ${error.message}`);
    console.error(`Error processing directory: ${error.message}`);
  } finally {
    process.exit(totalErrors === 0 ? 0 : 1);
  }
}

importNametags();