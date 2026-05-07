// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { parseKmlString, parseCoordinateString, kmlColorToHex } from '../src/core/maps/KmlParser'

describe('kmlColorToHex', () => {
  it('converts KML ABGR color to CSS hex', () => {
    // KML format: aabbggrr → CSS #rrggbb
    expect(kmlColorToHex('ff000000')).toBe('#000000') // black
    expect(kmlColorToHex('ff0000ff')).toBe('#ff0000') // red
    expect(kmlColorToHex('ff00ff00')).toBe('#00ff00') // green
    expect(kmlColorToHex('ffff0000')).toBe('#0000ff') // blue
    expect(kmlColorToHex('ffa79700')).toBe('#0097a7') // teal
    expect(kmlColorToHex('ff387109')).toBe('#097138') // dark green
    expect(kmlColorToHex('ff5b18c2')).toBe('#c2185b') // pink
  })

  it('returns default for invalid input', () => {
    expect(kmlColorToHex('abc')).toBe('#000000')
    expect(kmlColorToHex('')).toBe('#000000')
  })
})

describe('parseCoordinateString', () => {
  it('parses lon,lat,alt tuples', () => {
    const result = parseCoordinateString('34.802,30.988,0 34.818,30.976,0')
    expect(result).toEqual([
      { lat: 30.988, lon: 34.802 },
      { lat: 30.976, lon: 34.818 }
    ])
  })

  it('handles newlines between tuples', () => {
    const result = parseCoordinateString(`
      34.802,30.988,0
      34.818,30.976,0
    `)
    expect(result).toHaveLength(2)
  })

  it('handles lon,lat without altitude', () => {
    const result = parseCoordinateString('34.802,30.988')
    expect(result).toEqual([{ lat: 30.988, lon: 34.802 }])
  })

  it('returns empty for empty string', () => {
    expect(parseCoordinateString('')).toEqual([])
    expect(parseCoordinateString('  ')).toEqual([])
  })

  it('skips malformed tuples', () => {
    const result = parseCoordinateString('34.802,30.988,0 bad 34.818,30.976,0')
    expect(result).toHaveLength(2)
  })
})

describe('parseKmlString', () => {
  it('parses a minimal KML with one polygon', () => {
    const kml = `<?xml version='1.0' encoding='UTF-8'?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <name>Test</name>
        <Placemark>
          <name>Zone A</name>
          <Polygon>
            <outerBoundaryIs>
              <LinearRing>
                <coordinates>34.8,30.9,0 34.9,30.9,0 34.9,31.0,0 34.8,31.0,0 34.8,30.9,0</coordinates>
              </LinearRing>
            </outerBoundaryIs>
          </Polygon>
        </Placemark>
      </Document>
    </kml>`

    const result = parseKmlString(kml)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('Zone A')
    expect(result[0]!.type).toBe('polygon')
    expect(result[0]!.vertices).toHaveLength(5)
    expect(result[0]!.vertices[0]).toEqual({ lat: 30.9, lon: 34.8 })
  })

  it('parses styles and applies colors', () => {
    const kml = `<?xml version='1.0' encoding='UTF-8'?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Style id="red-line">
          <LineStyle>
            <color>ff0000ff</color>
            <width>3</width>
          </LineStyle>
        </Style>
        <Placemark>
          <name>Red Zone</name>
          <styleUrl>#red-line</styleUrl>
          <Polygon>
            <outerBoundaryIs>
              <LinearRing>
                <coordinates>0,0,0 1,0,0 1,1,0 0,0,0</coordinates>
              </LinearRing>
            </outerBoundaryIs>
          </Polygon>
        </Placemark>
      </Document>
    </kml>`

    const result = parseKmlString(kml)
    expect(result).toHaveLength(1)
    expect(result[0]!.color).toBe('#ff0000')
    expect(result[0]!.lineWidth).toBe(3)
  })

  it('resolves StyleMap to normal style', () => {
    const kml = `<?xml version='1.0' encoding='UTF-8'?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Style id="green-normal">
          <LineStyle><color>ff00ff00</color><width>4</width></LineStyle>
        </Style>
        <Style id="green-highlight">
          <LineStyle><color>ff00ff00</color><width>6</width></LineStyle>
        </Style>
        <StyleMap id="green">
          <Pair><key>normal</key><styleUrl>#green-normal</styleUrl></Pair>
          <Pair><key>highlight</key><styleUrl>#green-highlight</styleUrl></Pair>
        </StyleMap>
        <Placemark>
          <name>Green Zone</name>
          <styleUrl>#green</styleUrl>
          <Polygon>
            <outerBoundaryIs>
              <LinearRing>
                <coordinates>0,0,0 1,0,0 1,1,0 0,0,0</coordinates>
              </LinearRing>
            </outerBoundaryIs>
          </Polygon>
        </Placemark>
      </Document>
    </kml>`

    const result = parseKmlString(kml)
    expect(result).toHaveLength(1)
    expect(result[0]!.color).toBe('#00ff00')
    expect(result[0]!.lineWidth).toBe(4) // normal, not highlight
  })

  it('parses placemarks inside folders', () => {
    const kml = `<?xml version='1.0' encoding='UTF-8'?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Folder>
          <name>Layer 1</name>
          <Placemark>
            <name>P1</name>
            <Point><coordinates>34.8,30.9,0</coordinates></Point>
          </Placemark>
          <Placemark>
            <name>P2</name>
            <LineString><coordinates>34.8,30.9,0 34.9,31.0,0</coordinates></LineString>
          </Placemark>
        </Folder>
      </Document>
    </kml>`

    const result = parseKmlString(kml)
    expect(result).toHaveLength(2)
    expect(result[0]!.type).toBe('point')
    expect(result[0]!.name).toBe('P1')
    expect(result[1]!.type).toBe('linestring')
    expect(result[1]!.name).toBe('P2')
  })

  it('handles unnamed placemarks', () => {
    const kml = `<?xml version='1.0' encoding='UTF-8'?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <Placemark>
          <Polygon>
            <outerBoundaryIs>
              <LinearRing>
                <coordinates>0,0,0 1,0,0 1,1,0 0,0,0</coordinates>
              </LinearRing>
            </outerBoundaryIs>
          </Polygon>
        </Placemark>
      </Document>
    </kml>`

    const result = parseKmlString(kml)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('')
  })

  it('parses the real exercise KML with 4 polygons', () => {
    const kml = `<?xml version='1.0' encoding='UTF-8'?>
    <kml xmlns="http://www.opengis.net/kml/2.2">
      <Document>
        <name>Test Exercise</name>
        <Style id="poly-097138-4175-0-nodesc-normal">
          <LineStyle><color>ff387109</color><width>4.175</width></LineStyle>
          <PolyStyle><color>00387109</color></PolyStyle>
        </Style>
        <Style id="poly-097138-4175-0-nodesc-highlight">
          <LineStyle><color>ff387109</color><width>6.2625</width></LineStyle>
        </Style>
        <StyleMap id="poly-097138-4175-0-nodesc">
          <Pair><key>normal</key><styleUrl>#poly-097138-4175-0-nodesc-normal</styleUrl></Pair>
          <Pair><key>highlight</key><styleUrl>#poly-097138-4175-0-nodesc-highlight</styleUrl></Pair>
        </StyleMap>
        <Style id="poly-000000-4373-0-nodesc-normal">
          <LineStyle><color>ff000000</color><width>4.373</width></LineStyle>
        </Style>
        <StyleMap id="poly-000000-4373-0-nodesc">
          <Pair><key>normal</key><styleUrl>#poly-000000-4373-0-nodesc-normal</styleUrl></Pair>
          <Pair><key>highlight</key><styleUrl>#poly-000000-4373-0-nodesc-normal</styleUrl></Pair>
        </StyleMap>
        <Folder>
          <name>Untitled layer</name>
          <Placemark>
            <styleUrl>#poly-097138-4175-0-nodesc</styleUrl>
            <Polygon>
              <outerBoundaryIs>
                <LinearRing>
                  <tessellate>1</tessellate>
                  <coordinates>
                    34.8022154,30.9888868,0
                    34.8184695,30.9762184,0
                    34.8356738,30.9880139,0
                    34.8022154,30.9888868,0
                  </coordinates>
                </LinearRing>
              </outerBoundaryIs>
            </Polygon>
          </Placemark>
          <Placemark>
            <styleUrl>#poly-000000-4373-0-nodesc</styleUrl>
            <Polygon>
              <outerBoundaryIs>
                <LinearRing>
                  <coordinates>
                    34.8161014,31.0039871,0
                    34.8161116,30.9958381,0
                    34.8161014,31.0039871,0
                  </coordinates>
                </LinearRing>
              </outerBoundaryIs>
            </Polygon>
          </Placemark>
        </Folder>
      </Document>
    </kml>`

    const result = parseKmlString(kml)
    expect(result).toHaveLength(2)

    // First polygon — green via StyleMap, with PolyStyle fill color
    expect(result[0]!.type).toBe('polygon')
    expect(result[0]!.color).toBe('#097138')
    expect(result[0]!.fillColor).toBe('#097138')
    expect(result[0]!.lineWidth).toBe(4.175)
    expect(result[0]!.vertices[0]).toEqual({ lat: 30.9888868, lon: 34.8022154 })

    // Second polygon — black via StyleMap, no PolyStyle
    expect(result[1]!.type).toBe('polygon')
    expect(result[1]!.color).toBe('#000000')
    expect(result[1]!.fillColor).toBeUndefined()
    expect(result[1]!.lineWidth).toBe(4.373)
  })

  it('returns empty for non-KML input', () => {
    expect(parseKmlString('<html></html>')).toEqual([])
    expect(parseKmlString('')).toEqual([])
  })
})
