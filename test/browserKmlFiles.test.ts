// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { parseKmlImportText } from '../src/renderer/src/transport/browserKmlFiles'

describe('browser KML files', () => {
  it('parses KML imports without Node file APIs', () => {
    const result = parseKmlImportText(
      `<?xml version="1.0" encoding="UTF-8"?>
      <kml xmlns="http://www.opengis.net/kml/2.2">
        <Document>
          <Placemark>
            <name>Area</name>
            <Polygon>
              <outerBoundaryIs>
                <LinearRing>
                  <coordinates>
                    34.8,32.1,0 34.9,32.1,0 34.9,32.2,0 34.8,32.1,0
                  </coordinates>
                </LinearRing>
              </outerBoundaryIs>
            </Polygon>
          </Placemark>
        </Document>
      </kml>`,
      'overlay.kml'
    )

    expect(result.fileName).toBe('overlay.kml')
    expect(result.geometries).toHaveLength(1)
    expect(result.geometries[0]).toMatchObject({
      name: 'Area',
      type: 'polygon',
      vertices: [
        { lat: 32.1, lon: 34.8 },
        { lat: 32.1, lon: 34.9 },
        { lat: 32.2, lon: 34.9 },
        { lat: 32.1, lon: 34.8 }
      ]
    })
  })
})
