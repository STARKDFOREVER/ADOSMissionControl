import { describe, it, expect } from 'vitest';
import { parseKML } from '@/lib/formats/kml-parser';
import { generateKML } from '@/lib/formats/kml-exporter';
import type { Waypoint } from '@/lib/types/mission';

describe('parseKML', () => {
  it('parses KML with single Placemark containing Point coordinates', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <Point>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>77.59,12.97,50</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKML(kml);
    expect(result.waypoints).toHaveLength(1);
    // KML is lon,lat but output should be lat,lon
    expect(result.waypoints[0].lat).toBeCloseTo(12.97);
    expect(result.waypoints[0].lon).toBeCloseTo(77.59);
    expect(result.waypoints[0].alt).toBe(50);
  });

  it('swaps coordinate order from KML lon,lat to lat,lon', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <Point>
        <coordinates>-122.0822,37.4220,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKML(kml);
    expect(result.waypoints[0].lat).toBeCloseTo(37.4220);
    expect(result.waypoints[0].lon).toBeCloseTo(-122.0822);
  });

  it('parses LineString coordinates into paths and waypoints', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <LineString>
        <coordinates>77.59,12.97,0 77.60,12.98,0 77.61,12.99,0</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKML(kml);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]).toHaveLength(3);
    expect(result.waypoints).toHaveLength(3);
    // Check coordinate swap on path
    expect(result.paths[0][0]).toEqual([12.97, 77.59]);
  });

  it('parses Polygon coordinates into polygons array', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>77.58,12.96,0 77.60,12.96,0 77.60,12.98,0 77.58,12.98,0 77.58,12.96,0</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKML(kml);
    expect(result.polygons).toHaveLength(1);
    // KML polygon is closed (first == last), parser removes duplicate closing vertex
    expect(result.polygons[0]).toHaveLength(4);
    // Check lat,lon order
    expect(result.polygons[0][0]).toEqual([12.96, 77.58]);
  });

  it('handles empty document', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document></Document>
</kml>`;
    const result = parseKML(kml);
    expect(result.waypoints).toHaveLength(0);
    expect(result.polygons).toHaveLength(0);
    expect(result.paths).toHaveLength(0);
  });

  it('rejects malformed XML instead of importing nothing silently', () => {
    expect(() => parseKML('<not-valid-kml><<>')).toThrow(/not a valid KML/i);
  });

  it('parses nested folders with multiple placemarks', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Folder>
      <name>Waypoints</name>
      <Placemark>
        <Point><coordinates>77.59,12.97,50</coordinates></Point>
      </Placemark>
      <Folder>
        <name>Sub-folder</name>
        <Placemark>
          <Point><coordinates>77.60,12.98,60</coordinates></Point>
        </Placemark>
      </Folder>
    </Folder>
  </Document>
</kml>`;
    const result = parseKML(kml);
    expect(result.waypoints).toHaveLength(2);
    expect(result.waypoints[0].lat).toBeCloseTo(12.97);
    expect(result.waypoints[1].lat).toBeCloseTo(12.98);
  });

  it('extracts altitude from coordinates', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <Point><altitudeMode>relativeToGround</altitudeMode><coordinates>77.59,12.97,123.4</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKML(kml);
    expect(result.waypoints[0].alt).toBeCloseTo(123.4);
  });

  it('gives a point with no altitude the default altitude and says so', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <Point><coordinates>77.59,12.97</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKML(kml, { defaultAlt: 40 });
    expect(result.waypoints).toHaveLength(1);
    expect(result.waypoints[0].alt).toBe(40);
    expect(result.warnings).toHaveLength(1);
  });

  it('never turns a clamped-to-ground placemark into a terrain waypoint at 0 m', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <Point><altitudeMode>clampToGround</altitudeMode><coordinates>77.59,12.97,0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKML(kml, { defaultAlt: 40 });
    expect(result.waypoints[0].frame).toBeUndefined();
    expect(result.waypoints[0].alt).toBe(40);
    expect(result.warnings[0]).toMatch(/no usable altitude/);
  });

  it('parses multiple placemarks with mixed geometries', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <Point><coordinates>77.59,12.97,50</coordinates></Point>
    </Placemark>
    <Placemark>
      <LineString>
        <coordinates>77.60,12.98,0 77.61,12.99,0</coordinates>
      </LineString>
    </Placemark>
    <Placemark>
      <Polygon>
        <outerBoundaryIs><LinearRing>
          <coordinates>77.58,12.96,0 77.60,12.96,0 77.60,12.98,0 77.58,12.96,0</coordinates>
        </LinearRing></outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKML(kml);
    expect(result.waypoints.length).toBeGreaterThanOrEqual(1);
    expect(result.paths).toHaveLength(1);
    expect(result.polygons).toHaveLength(1);
  });

  it('handles LineString with whitespace between coordinates', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <LineString>
        <coordinates>
          77.59,12.97,0
          77.60,12.98,0
          77.61,12.99,0
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKML(kml);
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0]).toHaveLength(3);
  });

  it('handles negative coordinates (southern and western hemispheres)', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <Point><coordinates>-122.4194,37.7749,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <Point><coordinates>-43.1729,-22.9068,0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKML(kml);
    expect(result.waypoints).toHaveLength(2);
    expect(result.waypoints[0].lat).toBeCloseTo(37.7749);
    expect(result.waypoints[0].lon).toBeCloseTo(-122.4194);
    expect(result.waypoints[1].lat).toBeCloseTo(-22.9068);
    expect(result.waypoints[1].lon).toBeCloseTo(-43.1729);
  });
});

describe('KML commands and altitude modes', () => {
  it('keeps RTL and LAND through an export and re-import, with their exported altitudes', () => {
    const mission: Waypoint[] = [
      { id: 't', lat: 12.97, lon: 77.59, alt: 20, command: 'TAKEOFF' },
      { id: 'w', lat: 12.98, lon: 77.6, alt: 50, command: 'WAYPOINT' },
      { id: 'l', lat: 12.99, lon: 77.61, alt: 0, command: 'LAND' },
      // How ArduPilot downloads an RTL: 0 m at a stand-in position.
      { id: 'r', lat: 12.99, lon: 77.61, alt: 0, command: 'RTL', inheritsPosition: true },
    ];
    const back = parseKML(generateKML(mission, 'rtl', { defaultFrame: 'relative' }), { defaultAlt: 40 });
    expect(back.waypoints.map((w) => w.command)).toEqual(['TAKEOFF', 'WAYPOINT', 'LAND', 'RTL']);
    expect(back.waypoints.map((w) => w.alt)).toEqual([20, 50, 0, 0]);
    expect(back.waypoints[3].inheritsPosition).toBe(true);
    expect(back.waypoints[2].inheritsPosition).toBeUndefined();
    expect(back.warnings).toEqual([]);
  });

  it('takes the command from a placemark named RTL, LAND or TAKEOFF and does not trust its 0 m', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>LAND</name>
      <ExtendedData><Data name="adosAltitudeFrame"><value>relative</value></Data></ExtendedData>
      <Point><altitudeMode>relativeToGround</altitudeMode><coordinates>77.59,12.97,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>WP 2</name>
      <ExtendedData><Data name="adosAltitudeFrame"><value>relative</value></Data></ExtendedData>
      <Point><altitudeMode>relativeToGround</altitudeMode><coordinates>77.6,12.98,0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
    const result = parseKML(kml, { defaultAlt: 40 });
    expect(result.waypoints.map((w) => w.command)).toEqual(['LAND', 'WAYPOINT']);
    expect(result.waypoints[0].alt).toBe(40);
    expect(result.waypoints[1].alt).toBe(0);
    expect(result.warnings[0]).toMatch(/^1 point had no usable altitude/);
  });

  it('reads a placemark with no altitudeMode as clamped to ground and ignores its altitude', () => {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark><Point><coordinates>8.545,47.397,550</coordinates></Point></Placemark>
  </Document>
</kml>`;
    const result = parseKML(kml, { defaultAlt: 40 });
    expect(result.waypoints[0].alt).toBe(40);
    expect(result.waypoints[0].frame).toBeUndefined();
    expect(result.warnings[0]).toMatch(/no usable altitude/);
  });
});
