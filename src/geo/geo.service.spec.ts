import { ServiceUnavailableException } from '@nestjs/common';
import { GeoService } from './geo.service';

function createService(config: {
  googleMapsGeocodeTimeoutMs?: number;
  googleMapsServerKey?: string;
}): GeoService {
  return new GeoService({
    googleMapsGeocodeTimeoutMs: config.googleMapsGeocodeTimeoutMs ?? 5000,
    googleMapsServerKey: config.googleMapsServerKey ?? 'GOOGLE_MAPS_SERVER_KEY_PLACEHOLDER',
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe('GeoService', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn() as jest.MockedFunction<typeof fetch>;
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns the first Google geocode result without exposing the API key', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'OK',
        results: [
          {
            formatted_address: 'Bangkok, Thailand',
            geometry: {
              location: { lat: 13.7563, lng: 100.5018 },
              location_type: 'ROOFTOP',
            },
            place_id: 'place-1',
          },
        ],
      }),
    );

    const result = await createService({}).geocodeAddress('Bangkok');

    expect(result).toEqual({
      formattedAddress: 'Bangkok, Thailand',
      lat: 13.7563,
      lng: 100.5018,
      locationType: 'ROOFTOP',
      placeId: 'place-1',
      provider: 'google',
    });
    const [requestedUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestedUrl).toBeInstanceOf(URL);
    if (!(requestedUrl instanceof URL)) {
      throw new Error('Expected GeoService to request a URL instance');
    }
    expect(requestedUrl.searchParams.get('key')).toBe('GOOGLE_MAPS_SERVER_KEY_PLACEHOLDER');
    expect(requestInit).toBeDefined();
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null when Google returns ZERO_RESULTS', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ZERO_RESULTS', results: [] }));

    await expect(createService({}).geocodeAddress('unknown address')).resolves.toBeNull();
  });

  it('fails closed when Google returns a non-OK status', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'REQUEST_DENIED' }));

    await expect(createService({}).geocodeAddress('Bangkok')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('fails closed when the upstream request is aborted', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    await expect(createService({}).geocodeAddress('Bangkok')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('rejects geocoding when the server key is not configured', async () => {
    await expect(
      createService({ googleMapsServerKey: '' }).geocodeAddress('Bangkok'),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
