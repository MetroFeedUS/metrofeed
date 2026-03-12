const ROUTES = {
  louisville: {
    busRoutes: [
      {
            "id": "02",
            "label": "02 \u2013 Second Street",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "04",
            "label": "04 \u2013 Fourth Street",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "06",
            "label": "06 \u2013 Sixth Street - Taylor Boulevard",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "10",
            "label": "10 \u2013 Dixie Rapid",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "12",
            "label": "12 \u2013 Twelfth Street",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "15",
            "label": "15 \u2013 Market Street",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "17",
            "label": "17 \u2013 Bardstown Road",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "18",
            "label": "18 \u2013 Portland-Manslick",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "19",
            "label": "19 \u2013 Muhammad Ali Boulevard",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "21",
            "label": "21 \u2013 Chestnut Street",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "23",
            "label": "23 \u2013 Broadway",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "25",
            "label": "25 \u2013 Oak - Westport",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "27",
            "label": "27 \u2013 Hill Street",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "28",
            "label": "28 \u2013 Preston",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "29",
            "label": "29 \u2013 Eastern Parkway",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "31",
            "label": "31 \u2013 Shelbyville Road",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "40",
            "label": "40 \u2013 Taylorsville Road",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "43",
            "label": "43 \u2013 Portland Poplar Level",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "51",
            "label": "51 \u2013 Old Louisville Shopper",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "71",
            "label": "71 \u2013 Jeffersonville-Louisville-IUS",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "72",
            "label": "72 \u2013 Clarksville",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "93",
            "label": "93 \u2013 UPS U of L Shuttle",
            "dir0": "Outbound",
            "dir1": "Inbound"
      },
      {
            "id": "99",
            "label": "99 \u2013 UPS West Louisville",
            "dir0": "Outbound",
            "dir1": "Inbound"
      }
],
    railRoutes: []
  }
};
function getCityRoutes(cityId) {
  cityId = cityId || getCityIdFromPath();
  return ROUTES[cityId] || { busRoutes: [], railRoutes: [] };
}
window.ROUTES = ROUTES;
window.getCityRoutes = getCityRoutes;
