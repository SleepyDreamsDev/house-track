// GraphQL operation strings + variable builders for 999.md.
//
// The query/mutation BODIES are placeholders — they must be replaced with the
// real strings captured from a 999.md browser session (DevTools → Network →
// search/advert request → "Copy as fetch" → extract `query` from the body)
// before any live run will work. The variable shapes ARE accurate (verified
// 2026-04-26 against the saved fixtures).

import { FILTER } from './config.js';

// CAPTURED 2026-05-09T10:55:05.773Z by scripts/capture-session.ts
export const SEARCH_ADS_QUERY = `query SearchAds($input: Ads_SearchInput!, $isWorkCategory: Boolean = false, $includeCarsFeatures: Boolean = false, $includeBody: Boolean = false, $includeOwner: Boolean = false, $includeBoost: Boolean = false, $locale: Common_Locale) {
  searchAds(input: $input) {
    ads {
      ...AdsSearchFragment
      __typename
    }
    count
    reseted
    __typename
  }
}

fragment AdsSearchFragment on Advert {
  ...AdListFragment
  ...WorkCategoryFeatures @include(if: $isWorkCategory)
  reseted(
    input: {format: "2 Jan. 2006, 15:04", locale: $locale, timezone: "Europe/Chisinau", getDiff: false}
  )
  __typename
}

fragment AdListFragment on Advert {
  id
  title
  subCategory {
    ...CategoryAdFragment
    __typename
  }
  ...PriceAndImages
  ...CarsFeatures @include(if: $includeCarsFeatures)
  ...AdvertOwner @include(if: $includeOwner)
  transportYear: feature(id: 19) {
    ...FeatureValueFragment
    __typename
  }
  author: feature(id: 795) {
    ...FeatureValueFragment
    __typename
  }
  body: feature(id: 13) @include(if: $includeBody) {
    ...FeatureValueFragment
    __typename
  }
  uploadedVideos: feature(id: 2562) {
    ...FeatureValueFragment
    __typename
  }
  ...AdvertBooster @include(if: $includeBoost)
  label: displayProduct(alias: LABEL) {
    ... on DisplayLabel {
      enable
      ...DisplayLabelFragment
      __typename
    }
    __typename
  }
  frame: displayProduct(alias: FRAME) {
    ... on DisplayFrame {
      enable
      __typename
    }
    __typename
  }
  animation: displayProduct(alias: ANIMATION) {
    ... on DisplayAnimation {
      enable
      __typename
    }
    __typename
  }
  animationAndFrame: displayProduct(alias: ANIMATION_AND_FRAME) {
    ... on DisplayAnimationAndFrame {
      enable
      __typename
    }
    __typename
  }
  condition: feature(id: 593) {
    ...FeatureValueFragment
    __typename
  }
  owner {
    business {
      plan
      __typename
    }
    __typename
  }
  __typename
}

fragment CategoryAdFragment on Category {
  id
  title {
    ...TranslationFragment
    __typename
  }
  parent {
    id
    title {
      ...TranslationFragment
      __typename
    }
    parent {
      id
      title {
        ...TranslationFragment
        __typename
      }
      __typename
    }
    __typename
  }
  __typename
}

fragment TranslationFragment on I18NTr {
  translated
  __typename
}

fragment PriceAndImages on Advert {
  price: feature(id: 2) {
    ...FeatureValueFragment
    __typename
  }
  pricePerMeter: feature(id: 1385) {
    ...FeatureValueFragment
    __typename
  }
  oldPrice: feature(id: 1640) {
    ...FeatureValueFragment
    __typename
  }
  images: feature(id: 14) {
    ...FeatureValueFragment
    __typename
  }
  __typename
}

fragment FeatureValueFragment on FeatureValue {
  id
  type
  value
  __typename
}

fragment CarsFeatures on Advert {
  carFuel: feature(id: 151) {
    ...FeatureValueFragment
    __typename
  }
  carDrive: feature(id: 108) {
    ...FeatureValueFragment
    __typename
  }
  carTransmission: feature(id: 101) {
    ...FeatureValueFragment
    __typename
  }
  mileage: feature(id: 104) {
    ...FeatureValueFragment
    __typename
  }
  engineVolume: feature(id: 103) {
    ...FeatureValueFragment
    __typename
  }
  __typename
}

fragment AdvertOwner on Advert {
  owner {
    ...AccountFragment
    __typename
  }
  __typename
}

fragment AccountFragment on Account {
  id
  login
  avatar
  createdDate
  business {
    plan
    id
    __typename
  }
  verification {
    isVerified
    date(input: {timezone: "Europe/Chisinau", getDiff: false})
    __typename
  }
  __typename
}

fragment AdvertBooster on Advert {
  booster: product(alias: BOOSTER_V2) {
    enable
    __typename
  }
  __typename
}

fragment DisplayLabelFragment on DisplayLabel {
  title
  color {
    ...ColorFragment
    __typename
  }
  gradient {
    ...GradientFragment
    __typename
  }
  __typename
}

fragment ColorFragment on Common_Color {
  r
  g
  b
  a
  __typename
}

fragment GradientFragment on Gradient {
  from {
    ...ColorFragment
    __typename
  }
  to {
    ...ColorFragment
    __typename
  }
  position
  rotation
  __typename
}

fragment WorkCategoryFeatures on Advert {
  salary: feature(id: 266) {
    ...FeatureValueFragment
    __typename
  }
  workSchedule: feature(id: 260) {
    ...FeatureValueFragment
    __typename
  }
  workExperience: feature(id: 263) {
    ...FeatureValueFragment
    __typename
  }
  education: feature(id: 261) {
    ...FeatureValueFragment
    __typename
  }
  __typename
}`;

// CAPTURED 2026-05-09T10:55:05.773Z by scripts/capture-session.ts
export const GET_ADVERT_QUERY = `query GetAdvert($input: AdvertInput!) {
  advert(input: $input) {
    id
    state
    title
    posted
    reseted
    expire
    isExpired
    owner { __typename }
    autoRepublish { __typename }
    moderation { __typename }
    package { __typename }
    subCategory { __typename }
  }
}`;

// REPLACE-ME — populated by scripts/capture-session.ts after a live capture.
// 999.md's filter taxonomy operation name is unknown a priori; the script
// discovers it at run time. Until populated, parseTaxonomy() falls back to
// the known anchor IDs in src/config.ts (filterId 40 region, 41 offer type).
export const FILTER_TAXONOMY_QUERY = `query GetFilters($input: GetCategoryRequestInput!) {
  category(input: $input) {
    filters {
      ...FilterFragment
      features {
        ...FeatureFragment
        options {
          ...OptionFragment
          feature {
            ...FeatureFragment
            options {
              ...OptionFragment
              feature {
                ...FeatureFragment
                options {
                  ...OptionFragment
                  __typename
                }
                __typename
              }
              __typename
            }
            __typename
          }
          __typename
        }
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment FilterFragment on Filter {
  id
  type
  title {
    ...TranslationFragment
    __typename
  }
  collapsed
  units
  hasSearch
  onlyFixedPrice
  __typename
}

fragment TranslationFragment on I18NTr {
  translated
  __typename
}

fragment FeatureFragment on Feature {
  id
  fid
  type
  parentId
  childId
  title {
    ...TranslationFragment
    __typename
  }
  seoAlias {
    ...TranslationFragment
    __typename
  }
  presentInDynamicFilters
  __typename
}

fragment OptionFragment on Option {
  id
  title {
    i18n {
      ...i18NKeyFragment
      __typename
    }
    ...TranslationFragment
    __typename
  }
  parentId
  hasChildren
  isTop
  seoAlias {
    ...TranslationFragment
    __typename
  }
  presentInDynamicFilters
  checked
  __typename
}

fragment i18NKeyFragment on I18NKey {
  key
  ro
  ru
  __typename
}`;

export interface SearchInputOverride {
  subCategoryId: number;
  source: 'AD_SOURCE_DESKTOP';
  filters: ReadonlyArray<{
    filterId: number;
    features: ReadonlyArray<{ featureId: number; optionIds: number[] }>;
  }>;
}

export function buildSearchVariables(
  pageIdx: number,
  override?: SearchInputOverride,
): Record<string, unknown> {
  const base = override ?? FILTER.searchInput;
  return {
    input: {
      ...base,
      pagination: {
        limit: FILTER.pageSize,
        skip: pageIdx * FILTER.pageSize,
      },
    },
  };
}

export function buildAdvertVariables(id: string): Record<string, unknown> {
  return { input: { id } };
}
