import type { StayOffer } from "@/lib/stays";
import type {
  StaySearchProvider,
  StaySearchQuery,
  StaySearchResult,
} from "@/server/stays";

/**
 * SerpApi Google Hotels responses shaped like the documented examples
 * (https://serpapi.com/google-hotels-api), trimmed to the fields the app reads plus a few extras.
 */

export function hotelProperty(overrides: Record<string, unknown> = {}) {
  return {
    type: "hotel",
    name: "Grand Summit Lodge",
    description: "Slopeside lodge with a heated pool and ski valet.",
    link: "https://www.grandsummit.example/stay",
    property_token: "ChkIv_HyiNKHpf6yARoML2cvMXozdGJnZ3BzEAE",
    serpapi_property_details_link:
      "https://serpapi.com/search.json?engine=google_hotels&property_token=ChkI",
    gps_coordinates: { latitude: 40.6514, longitude: -111.5079 },
    check_in_time: "4:00 PM",
    check_out_time: "11:00 AM",
    rate_per_night: {
      lowest: "$412",
      extracted_lowest: 412,
      before_taxes_fees: "$360",
      extracted_before_taxes_fees: 360,
    },
    total_rate: {
      lowest: "$824",
      extracted_lowest: 824,
      before_taxes_fees: "$720",
      extracted_before_taxes_fees: 720,
    },
    prices: [
      {
        source: "Expedia",
        logo: "https://www.gstatic.com/travel-hotels/branding/expedia.png",
        num_guests: 4,
        rate_per_night: { lowest: "$430", extracted_lowest: 430 },
      },
      {
        source: "Booking.com",
        logo: "https://www.gstatic.com/travel-hotels/branding/booking.png",
        num_guests: 4,
        rate_per_night: { lowest: "$412", extracted_lowest: 412 },
      },
    ],
    nearby_places: [{ name: "Canyons Village" }],
    hotel_class: "4-star hotel",
    extracted_hotel_class: 4,
    images: [
      {
        thumbnail:
          "https://lh3.googleusercontent.com/p/AF1QipO1Dou9=s287-w287-h192",
        original_image: "https://lh5.googleusercontent.com/p/AF1QipO1Dou9",
      },
    ],
    overall_rating: 4.5612,
    reviews: 812,
    location_rating: 4.4,
    amenities: ["Free Wi-Fi", "Pool", "Hot tub", "Ski-in/ski-out"],
    excluded_amenities: ["No airport shuttle"],
    essential_info: [],
    ...overrides,
  };
}

export function rentalProperty(overrides: Record<string, unknown> = {}) {
  return {
    type: "vacation rental",
    name: "Old Town Ski Chalet",
    gps_coordinates: { latitude: 40.6461, longitude: -111.498 },
    check_in_time: "4:00 PM",
    check_out_time: "10:00 AM",
    rate_per_night: { lowest: "$690", extracted_lowest: 690 },
    total_rate: { lowest: "$1,380", extracted_lowest: 1380 },
    prices: [
      {
        source: "Vrbo",
        logo: "https://www.gstatic.com/travel-hotels/branding/vrbo.png",
        rate_per_night: { lowest: "$690", extracted_lowest: 690 },
      },
    ],
    images: [
      {
        thumbnail: "https://lh5.googleusercontent.com/proxy/chalet=s287",
        original_image: "https://images.vrbo.example/chalet.jpg",
      },
    ],
    overall_rating: 4.82,
    reviews: 57,
    amenities: ["Hot tub", "Kitchen", "Fireplace"],
    essential_info: ["Entire house", "Sleeps 10", "4 bedrooms", "3 bathrooms"],
    property_token: "ChoQ5YiTp-rKmO60ARoNL2cvMTFzc2djMTNqcRAC",
    ...overrides,
  };
}

export function hotelsSearch(
  properties: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    search_metadata: {
      id: "695e5760fe1c6b0dfce576e7",
      status: "Success",
      google_hotels_url:
        "https://www.google.com/_/TravelFrontendUi/data/batchexecute?rpcids=AtySUc",
      total_time_taken: 2.6,
    },
    search_parameters: { engine: "google_hotels", currency: "USD" },
    search_information: { total_results: properties.length },
    brands: [{ id: 33, name: "Accor Live Limitless" }],
    ads: [
      {
        name: "Sponsored Inn",
        source: "Booking.com",
        link: "https://www.google.com/aclk?sa=l&ai=abc",
        extracted_price: 70,
      },
    ],
    properties,
    serpapi_pagination: { current_from: 1, current_to: 20 },
    ...overrides,
  };
}

export function sampleStay(overrides: Partial<StayOffer> = {}): StayOffer {
  return {
    offerId: "gh_0123456789abcdef01234567",
    name: "Grand Summit Lodge",
    kind: "hotel",
    description: "Slopeside lodge.",
    hotelClass: 4,
    rating: 4.6,
    reviews: 812,
    essentialInfo: [],
    amenities: ["Pool"],
    nightlyAmount: "412.00",
    totalAmount: "824.00",
    currency: "USD",
    priceSources: [
      { source: "Booking.com", nightlyAmount: "412.00" },
      { source: "Expedia", nightlyAmount: "430.00" },
    ],
    sponsored: false,
    latitude: 40.6514,
    longitude: -111.5079,
    checkInTime: "4:00 PM",
    checkOutTime: "11:00 AM",
    imageUrl: "https://lh3.googleusercontent.com/p/AF1QipO1Dou9=s287",
    propertyUrl: "https://www.grandsummit.example/stay",
    bookingUrl:
      "https://www.google.com/travel/search?q=Grand%20Summit%20Lodge%2C%20Park%20City",
    propertyToken: "ChkIv_HyiNKHpf6yARoML2cvMXozdGJnZ3BzEAE",
    location: "Park City",
    checkIn: "2027-03-05",
    checkOut: "2027-03-07",
    nights: 2,
    guests: 4,
    retrievedAt: "2026-10-15T12:00:00.000Z",
    sourceName: "Google Hotels via SerpApi",
    providerId: "serpapi",
    ...overrides,
  };
}

/** A stay provider that answers from fixed results and records what it was asked. */
export class FakeStayProvider implements StaySearchProvider {
  readonly id = "serpapi-hotels";
  readonly label = "Google Hotels via SerpApi";
  readonly queries: StaySearchQuery[] = [];

  constructor(
    private readonly offers: StayOffer[],
    private readonly error?: Error,
    readonly supportsVacationRentals = true,
  ) {}

  async search(query: StaySearchQuery): Promise<StaySearchResult> {
    this.queries.push(query);
    if (this.error) throw this.error;
    return {
      search: {
        location: query.location,
        checkIn: query.checkIn,
        checkOut: query.checkOut,
        nights: 2,
        guests: query.guests,
        kind: query.kind,
        bedrooms: query.bedrooms,
        minPrice: query.minPrice,
        maxPrice: query.maxPrice,
        sort: query.sort,
        currency: "USD",
      },
      offers: this.offers,
      retrievedAt: "2026-10-15T12:00:00.000Z",
      sourceName: this.label,
    };
  }
}
