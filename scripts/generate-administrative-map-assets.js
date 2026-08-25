const { createHash } = require('crypto');
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const EXPECTED_HASHES = {
  adm1: '34abbc739f8d3c92bfe68ee43c51313d89ae26643806f2e7daf5c68423bbaf9e',
  adm2: '1a1d85b08ff32f57da9cdb42f6a3283ec70bdbaf7d76735298962457cad7beef',
  adm3: 'bcaa7af449c894513b8ed119e10afc19c9a589d0f00ec06c609c41d0f3eef659',
  bma: '5845fc2d1eb6ffe8432babbd2b88e93fd1ec0922d32a8e251f27935f1a173e86',
  dopa: '5977e39e689d229668dabb2ff47f1a1a4bec341bd1efa0792cb45cad8e16d6e9',
};

function fail(message) {
  throw new Error(message);
}

function hashFile(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function assertPinnedHash(key, filePath) {
  const actual = hashFile(filePath);
  if (actual !== EXPECTED_HASHES[key]) {
    fail(`${key} SHA-256 mismatch: expected ${EXPECTED_HASHES[key]}, got ${actual}`);
  }
}

function readDopaCatalog(filePath) {
  const workbook = XLSX.readFile(filePath);
  const rows = XLSX.utils
    .sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
      raw: false,
      defval: '',
    })
    .slice(5);
  const provinces = [];
  const districts = [];
  const subDistricts = [];

  for (const row of rows) {
    const rawCode = String(row[0]);
    const nameTh = String(row[1]).trim();
    const retiredOn = String(row[3]);
    if (!/^\d{8}$/.test(rawCode) || retiredOn !== '0' || !nameTh) continue;
    if (rawCode.slice(2) === '000000') {
      provinces.push([rawCode.slice(0, 2), nameTh]);
    } else if (rawCode.slice(4) === '0000') {
      districts.push([rawCode.slice(0, 4), rawCode.slice(0, 2), nameTh]);
    } else if (rawCode.slice(6) === '00') {
      subDistricts.push([
        rawCode.slice(0, 6),
        rawCode.slice(0, 4),
        rawCode.slice(0, 2),
        nameTh,
      ]);
    }
  }

  if (provinces.length !== 77 || districts.length !== 928 || subDistricts.length !== 7436) {
    fail(
      `Unexpected DOPA active counts ${provinces.length}/${districts.length}/${subDistricts.length}`,
    );
  }
  return { provinces, districts, subDistricts };
}

function catalogIndexes(catalog) {
  const subDistrictsByParentName = new Map();
  for (const [code, districtCode, provinceCode, name] of catalog.subDistricts) {
    subDistrictsByParentName.set(
      `${districtCode}:${name.replace(/^(ตำบล|แขวง)/, '')}`,
      { code, districtCode, provinceCode, name },
    );
  }
  return {
    provinces: new Map(catalog.provinces.map(([code, name]) => [code, { name }])),
    districts: new Map(
      catalog.districts.map(([code, provinceCode, name]) => [code, { provinceCode, name }]),
    ),
    subDistricts: new Map(
      catalog.subDistricts.map(([code, districtCode, provinceCode, name]) => [
        code,
        { districtCode, provinceCode, name },
      ]),
    ),
    subDistrictsByParentName,
  };
}

function compactFeature(feature, level, indexes) {
  const properties = feature.properties;
  if (level === 1) {
    const code = properties.ADM1_PCODE.slice(2);
    const canonical = indexes.provinces.get(code);
    if (!canonical) fail(`Province geometry has no canonical code ${code}`);
    return {
      type: 'Feature',
      properties: {
        code,
        name: canonical.name,
      },
      geometry: feature.geometry,
    };
  }
  if (level === 2) {
    const code = properties.ADM2_PCODE.slice(2);
    const canonical = indexes.districts.get(code);
    if (!canonical) fail(`District geometry has no canonical code ${code}`);
    return {
      type: 'Feature',
      properties: {
        code,
        name: canonical.name.replace(/^(อำเภอ|เขต)/, ''),
        parentCode: canonical.provinceCode,
      },
      geometry: feature.geometry,
    };
  }
  let code = properties.ADM3_PCODE.slice(2);
  // ท่าแฝก moved from Tha Pla (5303) to Nam Pat (5304) in 2015. The polygon
  // itself is still valid in the 2019 COD snapshot; only its canonical parent/code drifted.
  if (code === '530306') code = '530407';
  const canonical = indexes.subDistricts.get(code);
  if (!canonical) return null;
  return {
    type: 'Feature',
    properties: {
      code,
      name: canonical.name.replace(/^(ตำบล|แขวง)/, ''),
      parentCode: canonical.districtCode,
    },
    geometry: feature.geometry,
  };
}

function squaredSegmentDistance(point, start, end) {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;
  if (dx !== 0 || dy !== 0) {
    const ratio = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (ratio > 1) {
      x = end[0];
      y = end[1];
    } else if (ratio > 0) {
      x += dx * ratio;
      y += dy * ratio;
    }
  }
  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function simplifyLine(points, toleranceSquared) {
  if (points.length <= 2) return points;
  let furthestIndex = 0;
  let furthestDistance = toleranceSquared;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = squaredSegmentDistance(points[index], points[0], points.at(-1));
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestIndex = index;
    }
  }
  if (furthestIndex === 0) return [points[0], points.at(-1)];
  return [
    ...simplifyLine(points.slice(0, furthestIndex + 1), toleranceSquared).slice(0, -1),
    ...simplifyLine(points.slice(furthestIndex), toleranceSquared),
  ];
}

function simplifyRing(ring, tolerance = 0.00015) {
  const open = ring.slice(0, -1);
  const simplified = simplifyLine(open, tolerance * tolerance);
  if (simplified.length < 3) return ring;
  return [...simplified, simplified[0]];
}

function simplifyGeometry(geometry) {
  if (geometry.type === 'Polygon') {
    return { ...geometry, coordinates: geometry.coordinates.map((ring) => simplifyRing(ring)) };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) => simplifyRing(ring)),
      ),
    };
  }
  fail(`Unsupported BMA geometry type ${geometry.type}`);
}

function compactBmaFeature(feature, indexes) {
  // SCODE is the national DOPA code. SCODE_BMA is Bangkok's internal sequence
  // and intentionally differs for 20 long-established khwaeng.
  const rawCode = String(feature.properties.SCODE || '');
  const rawDistrictCode = String(feature.properties.DCODE || rawCode.slice(0, 4));
  const rawName = String(feature.properties.SNAME || '').replace(/^(ตำบล|แขวง)/, '');
  let code = rawCode;
  let canonical = indexes.subDistricts.get(code);
  if (!canonical) {
    const matched = indexes.subDistrictsByParentName.get(`${rawDistrictCode}:${rawName}`);
    if (matched) {
      code = matched.code;
      canonical = matched;
    }
  }
  if (!canonical || canonical.provinceCode !== '10') {
    fail(`BMA geometry has no current Bangkok canonical code ${code}`);
  }
  return {
    type: 'Feature',
    properties: {
      code,
      name: canonical.name.replace(/^(ตำบล|แขวง)/, ''),
      parentCode: canonical.districtCode,
    },
    geometry: simplifyGeometry(feature.geometry),
  };
}

function writeCollection(filePath, features) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ type: 'FeatureCollection', features }));
}

function writeCatalog(outputPath, catalog) {
  const source = `/* eslint-disable max-lines */
/**
 * Generated from DOPA CCAATT, active records as of 2023-09-01.
 * Rebuild with scripts/generate-administrative-map-assets.js; do not hand-edit.
 */
export const ADMINISTRATIVE_AREA_SOURCE = {
  authority: 'กรมการปกครอง กระทรวงมหาดไทย (DOPA)',
  asOf: '2023-09-01',
  url: 'https://stat.bora.dopa.go.th/stat/statnew/statMenu/newStat/ccaa.php',
  sha256: '${EXPECTED_HASHES.dopa}',
} as const;

export const ADMINISTRATIVE_PROVINCES = ${JSON.stringify(catalog.provinces)} as const;
export const ADMINISTRATIVE_DISTRICTS = ${JSON.stringify(catalog.districts)} as const;
export const ADMINISTRATIVE_SUB_DISTRICTS = ${JSON.stringify(catalog.subDistricts)} as const;
`;
  writeFileSync(outputPath, source);
}

function main() {
  const [dopaPath, adm1Path, adm2Path, adm3Path, bmaPath, frontendRoot] = process.argv.slice(2);
  if (!dopaPath || !adm1Path || !adm2Path || !adm3Path || !bmaPath || !frontendRoot) {
    fail(
      'Usage: node scripts/generate-administrative-map-assets.js <ccaatt.xlsx> <adm1.geojson> <adm2.geojson> <adm3.geojson> <bma-subdistricts.geojson> <frontend-root>',
    );
  }
  assertPinnedHash('dopa', dopaPath);
  assertPinnedHash('adm1', adm1Path);
  assertPinnedHash('adm2', adm2Path);
  assertPinnedHash('adm3', adm3Path);
  assertPinnedHash('bma', bmaPath);

  const catalog = readDopaCatalog(dopaPath);
  const indexes = catalogIndexes(catalog);
  writeCatalog(
    path.resolve(__dirname, '../src/database/administrative-area-catalog.ts'),
    catalog,
  );

  const publicRoot = path.resolve(frontendRoot, 'public/maps/thailand-administrative');
  rmSync(publicRoot, { recursive: true, force: true });
  mkdirSync(publicRoot, { recursive: true });
  const adm1 = JSON.parse(readFileSync(adm1Path, 'utf8')).features.map((feature) =>
    compactFeature(feature, 1, indexes),
  );
  const adm2 = JSON.parse(readFileSync(adm2Path, 'utf8')).features.map((feature) =>
    compactFeature(feature, 2, indexes),
  );
  const adm3OutsideBangkok = JSON.parse(readFileSync(adm3Path, 'utf8')).features
    .map((feature) => compactFeature(feature, 3, indexes))
    .filter((feature) => feature && !feature.properties.code.startsWith('10'));
  const bangkokAdm3 = JSON.parse(readFileSync(bmaPath, 'utf8')).features.map((feature) =>
    compactBmaFeature(feature, indexes),
  );
  const adm3 = [...adm3OutsideBangkok, ...bangkokAdm3];
  writeCollection(path.join(publicRoot, 'provinces.geojson'), adm1);

  for (const [provinceCode] of catalog.provinces) {
    writeCollection(
      path.join(publicRoot, 'districts', `${provinceCode}.geojson`),
      adm2.filter((feature) => feature.properties.parentCode === provinceCode),
    );
    writeCollection(
      path.join(publicRoot, 'subdistricts', `${provinceCode}.geojson`),
      adm3.filter((feature) => feature.properties.code.startsWith(provinceCode)),
    );
  }

  const dopaSubDistrictCodes = new Set(catalog.subDistricts.map((row) => row[0]));
  const geometrySubDistrictCodes = new Set(adm3.map((feature) => feature.properties.code));
  const missingGeometryCodes = catalog.subDistricts
    .filter((row) => !geometrySubDistrictCodes.has(row[0]))
    .map(([code, districtCode, provinceCode, name]) => ({
      code,
      districtCode,
      provinceCode,
      name,
    }));
  const retiredGeometryCodes = adm3
    .filter((feature) => !dopaSubDistrictCodes.has(feature.properties.code))
    .map((feature) => ({
      code: feature.properties.code,
      parentCode: feature.properties.parentCode,
      name: feature.properties.name,
    }));
  if (missingGeometryCodes.length > 0 || retiredGeometryCodes.length > 0) {
    fail(
      `Geometry coverage mismatch: missing ${missingGeometryCodes.length}, extra ${retiredGeometryCodes.length}`,
    );
  }
  const manifest = {
    canonical: {
      authority: 'DOPA CCAATT',
      asOf: '2023-09-01',
      sha256: EXPECTED_HASHES.dopa,
      counts: { provinces: 77, districts: 928, subDistricts: 7436 },
    },
    geometry: {
      authority: 'Royal Thai Survey Department / OCHA COD via mapthai',
      asOf: '2019-11-06',
      license: 'CC BY 3.0 IGO',
      source: 'https://github.com/ReynoldsWJ55/thailand-canonical-admin-names/releases/tag/v1.0.2',
      sha256: {
        adm1: EXPECTED_HASHES.adm1,
        adm2: EXPECTED_HASHES.adm2,
        adm3: EXPECTED_HASHES.adm3,
        bma: EXPECTED_HASHES.bma,
      },
      counts: { provinces: adm1.length, districts: adm2.length, subDistricts: adm3.length },
      currentCoverage: true,
      bangkokOverlay: {
        authority: 'Bangkok Metropolitan Administration (BMA)',
        source:
          'https://district.bangkok.go.th/arcgis/rest/services/bma/SEDBasemap/MapServer/13',
        count: bangkokAdm3.length,
      },
      movedCodeRemap: { from: '530306', to: '530407', name: 'ท่าแฝก' },
    },
  };
  writeFileSync(path.join(publicRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    path.join(publicRoot, 'SOURCE.md'),
    `# Thailand administrative map data\n\n` +
      `- Canonical codes/names: DOPA CCAATT, 2023-09-01.\n` +
      `- Geometry: Royal Thai Survey Department, 2019-11-06; OCHA COD lineage via mapthai.\n` +
      `- Current Bangkok overlay: Bangkok Metropolitan Administration public ArcGIS MapServer.\n` +
      `- Geometry license: CC BY 3.0 IGO. Data compilation: CC BY 4.0.\n` +
      `- Generated assets retain only canonical code, Thai name, parent code, and simplified geometry.\n` +
      `- Bangkok polygons are simplified at generation time; ท่าแฝก keeps its COD polygon with the current DOPA code/parent.\n` +
      `- See manifest.json for pinned hashes and exact current coverage.\n`,
  );

  console.log(
    `Generated ${adm1.length}/${adm2.length}/${adm3.length} geometry features; ` +
      `${missingGeometryCodes.length} current subdistrict codes have no 2019 polygon.`,
  );
}

main();
