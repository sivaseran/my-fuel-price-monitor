export const DEFAULT_RADIUS_MILES = 10;

export const stations = [
  {
    id: 'north-terrace',
    name: 'North Terrace Service Station',
    shortName: 'North Terrace',
    brand: 'JET',
    address: 'North Terrace, Mildenhall, Bury Saint Edmunds, IP28 7AA',
    postcode: 'IP28 7AA',
    fuels: ['E10', 'B7_STANDARD', 'E5'],
  },
  {
    id: 'fordham',
    name: 'Fordham Service Station',
    shortName: 'Fordham',
    brand: 'JET',
    address: '31 Carter St, Fordham, Ely, CB7 5NG',
    postcode: 'CB7 5NG',
    fuels: ['E10', 'B7_STANDARD'],
  },
  {
    id: 'starthill',
    name: 'Starthill Service Station',
    shortName: 'Starthill',
    brand: 'JET',
    address: '111 Ashingdon Road, Rochford, Essex, SS4 1RF',
    postcode: 'SS4 1RF',
    fuels: ['E10', 'B7_STANDARD', 'E5', 'B7_PREMIUM'],
  },
];

export const fuelLabels = {
  E10: 'Unleaded',
  B7_STANDARD: 'Diesel',
  E5: 'Premium Petrol',
  B7_PREMIUM: 'Premium Diesel',
};
