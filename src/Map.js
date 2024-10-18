import React, { useState, useEffect, useCallback } from 'react';
import Map, { Source, Layer, Marker, Popup, useMap } from 'react-map-gl';
import axios from 'axios';
import { bbox, squareGrid, center, nearestPoint, distance, featureCollection, dissolve, point, buffer, booleanPointInPolygon } from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import bikePathsData from './geo_data/bike_routes_datasd.geojson';

const SD_BOUNDS = [-117.6, 32.5, -116.1, 33.5]; // [west, south, east, north]
const CHATGPT_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_TOKEN;
const CHATGPT_API_KEY = process.env.REACT_APP_CHATGPT_API_KEY;


const Legend = ({ layerVisibility, toggleLayer }) => {
  return (
    <div style={{
      position: 'absolute',
      top: '10px',
      right: '10px',
      backgroundColor: 'white',
      padding: '10px',
      borderRadius: '5px',
      zIndex: 1
    }}>
      <h3>Legend</h3>
      <div>
        <button 
          onClick={() => toggleLayer('environmental')}
          style={{ backgroundColor: layerVisibility.environmental ? 'green' : 'red' }}
        >
          Environmental Factors
        </button>
      </div>
      <div>
        <button 
          onClick={() => toggleLayer('healthcare')}
          style={{ backgroundColor: layerVisibility.healthcare ? 'green' : 'red' }}
        >
          Healthcare Facilities & Access
        </button>
      </div>
      <div>
        <button 
          onClick={() => toggleLayer('bikePaths')}
          style={{ backgroundColor: layerVisibility.bikePaths ? 'green' : 'red' }}
        >
          Bike Paths and Parks
        </button>
      </div>
      <div style={{ marginTop: '10px' }}>
        <div>Environmental Factors:</div>
        <div style={{ 
          background: 'linear-gradient(to right, #8b0000, #ff0000, #0000ff, #00008b)', 
          height: '20px', 
          width: '100%', 
          marginTop: '5px' 
        }}></div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Worst</span>
          <span>Best</span>
        </div>
      </div>
      <div>
        <div>Healthcare Access:</div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'red' }}>Low</span>
          <span style={{ color: 'yellow' }}>Medium</span>
        </div>
      </div>
      <div>
        <div>Healthcare Facilities:</div>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 21h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18V7H3v2zm0-6v2h18V3H3z" fill="#1e90ff"/>
          </svg>
          <span style={{ marginLeft: '5px' }}>Facility</span>
        </div>
      </div>
      <div>
        <div>Bike Paths and Parks:</div>
        <div style={{ backgroundColor: 'darkgreen', border: '1px solid black', width: '20px', height: '5px' }}></div>
      </div>
    </div>
  );
};

const ParkPopup = ({ park, onClose }) => {
  const {
    full_name,
    common_name,
    address_lo,
    community,
    acres,
    desig_use,
    tennis,
    basketball,
    playground,
    baseball_90,
    baseball_50_6,
    softball,
    sand_vball,
    multi_purpose,
    concession_stand,
    comfort_station,
    field_lighting,
    recycled_water
  } = park.properties;

  const facilities = [
    tennis && `Tennis courts: ${tennis}`,
    basketball && `Basketball courts: ${basketball}`,
    playground && 'Playground',
    baseball_90 && `Baseball fields (90ft): ${baseball_90}`,
    baseball_50_6 && `Baseball fields (50/60ft): ${baseball_50_6}`,
    softball && `Softball fields: ${softball}`,
    sand_vball && `Sand volleyball courts: ${sand_vball}`,
    multi_purpose && `Multi-purpose fields: ${multi_purpose}`,
    concession_stand && 'Concession stand',
    comfort_station && 'Comfort station',
    field_lighting === 'Y' && 'Field lighting',
    recycled_water === 'Y' && 'Recycled water used'
  ].filter(Boolean);

  return (
    <div style={{ maxWidth: '300px' }}>
      <h3>{full_name || common_name}</h3>
      <p>{address_lo}</p>
      <p>Community: {community}</p>
      <p>Size: {acres.toFixed(2)} acres</p>
      <p>Type: {desig_use}</p>
      {facilities.length > 0 && (
        <>
          <h4>Facilities:</h4>
          <ul>
            {facilities.map((facility, index) => (
              <li key={index}>{facility}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
};


const MapComponent = () => {
  const [viewport, setViewport] = useState({
    latitude: 32.7157,
    longitude: -117.1611,
    zoom: 10,
  });
  const [healthcareFacilities, setHealthcareFacilities] = useState(null);
  const [accessPolygons, setAccessPolygons] = useState(null);
  const [environmentalData, setEnvironmentalData] = useState(null);
  const [bikePaths, setBikePaths] = useState(null);
  const [parks, setParks] = useState(null);
  const [layerVisibility, setLayerVisibility] = useState({
    environmental: true,
    healthcare: false,
    bikePaths: true
  });
  const [selectedPark, setSelectedPark] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [healthyPlan, setHealthyPlan] = useState(null);
  // const [parkGuide, setParkGuide] = useState(null);

  const isWithinSanDiego = useCallback(([lon, lat]) => {
    return lon >= SD_BOUNDS[0] && lon <= SD_BOUNDS[2] &&
           lat >= SD_BOUNDS[1] && lat <= SD_BOUNDS[3];
  }, []);


  const generateParkGuide = async (park) => {
    const parkInfo = park.properties;
    const [longitude, latitude] = center(park).geometry.coordinates;
    const prompt = `Create a fun, user-readable guide about the following park (3-4 sentences):
    ${parkInfo.full_name || parkInfo.common_name} is a ${parkInfo.acres.toFixed(2)}-acre ${parkInfo.desig_use} located in ${parkInfo.community}. 
    Facilities: ${Object.entries(parkInfo)
      .filter(([key, value]) => ['tennis', 'basketball', 'playground', 'baseball_90', 'baseball_50_6', 'softball', 'sand_vball', 'multi_purpose', 'concession_stand', 'comfort_station', 'field_lighting', 'recycled_water'].includes(key) && value)
      .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`)
      .join(', ')}
    Highlight its main features and why someone might want to visit.
    
    Please include what the park has to offer, its location, and any interesting features.`;

    try {
      const response = await axios.post(
        CHATGPT_API_ENDPOINT,
        {
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 200,
        },
        {
          headers: {
            'Authorization': `Bearer ${CHATGPT_API_KEY}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      console.error('Error generating park guide:', error);
      return 'Sorry, we couldn\'t generate a guide for this park at the moment.';
    }
  };

  const fetchHealthcareFacilities = useCallback(async () => {
    try {
      const response = await axios.get('https://geo.sandag.org/server/rest/services/Hosted/Healthcare_Facilities/FeatureServer/0/query', {
        params: {
          where: '1=1',
          outFields: '*',
          outSR: '4326',
          f: 'json'
        }
      });

      const features = response.data.features
        .map(feature => ({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [feature.geometry.x, feature.geometry.y]
          },
          properties: feature.attributes
        }))
        .filter(feature => isWithinSanDiego(feature.geometry.coordinates));

      setHealthcareFacilities({
        type: 'FeatureCollection',
        features: features
      });
    } catch (error) {
      console.error('Error fetching healthcare facilities', error);
    }
  }, [isWithinSanDiego]);

  const fetchEnvironmentalData = useCallback(async () => {
    try {
      const response = await axios.get('https://api.healthyplacesindex.org/api/hpi', {
        params: {
          geography: 'tracts',
          year: '2019',
          indicator: 'clean_enviro',
          format: 'geojson',
          key: process.env.REACT_APP_HPI_API_KEY
        }
      });

      const sdFeatures = response.data.features.filter(feature => {
        const polygonCenter = center(feature);
        return isWithinSanDiego(polygonCenter.geometry.coordinates);
      });

      setEnvironmentalData({
        type: 'FeatureCollection',
        features: sdFeatures
      });
    } catch (error) {
      console.error('Error fetching environmental data', error);
    }
  }, [isWithinSanDiego]);

  const loadBikePaths = useCallback(() => {
    setBikePaths(bikePathsData);
  }, []);

  const fetchParks = useCallback(async () => {
    try {
      const response = await axios.get('https://geo.sandag.org/server/rest/services/Hosted/Parks_SD/FeatureServer/0/query', {
        params: {
          where: '1=1',
          outFields: '*',
          outSR: '4326',
          f: 'json'
        }
      });

      const features = response.data.features
        .map(feature => ({
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: feature.geometry.rings
          },
          properties: feature.attributes
        }))
        .filter(feature => {
          const polygonCenter = center(feature);
          return isWithinSanDiego(polygonCenter.geometry.coordinates);
        });

      setParks({
        type: 'FeatureCollection',
        features: features
      });
    } catch (error) {
      console.error('Error fetching parks', error);
    }
  }, [isWithinSanDiego]);

  const generateAccessPolygons = useCallback(() => {
    if (!healthcareFacilities) return;

    const boundingBox = bbox(healthcareFacilities);
    const cellSide = 0.5; // approx. 0.5 km
    const options = { units: 'kilometers' };
    const grid = squareGrid(boundingBox, cellSide, options);

    const redPolygons = [];
    const yellowPolygons = [];

    grid.features.forEach(cell => {
      const cellCenter = center(cell);
      const nearestFacility = nearestPoint(cellCenter, healthcareFacilities);
      const distanceToNearest = distance(cellCenter, nearestFacility, options);

      if (distanceToNearest > 5) {
        redPolygons.push(cell);
      } else if (distanceToNearest > 3) {
        yellowPolygons.push(cell);
      }
    });

    // Merge individual polygons
    const mergedRed = dissolve(featureCollection(redPolygons));
    const mergedYellow = dissolve(featureCollection(yellowPolygons));

    setAccessPolygons({
      type: 'FeatureCollection',
      features: [
        ...mergedRed.features.map(f => ({ ...f, properties: { color: 'red' } })),
        ...mergedYellow.features.map(f => ({ ...f, properties: { color: 'yellow' } }))
      ]
    });
  }, [healthcareFacilities]);

  useEffect(() => {
    fetchHealthcareFacilities();
    fetchEnvironmentalData();
    loadBikePaths();
    fetchParks();
  }, [fetchHealthcareFacilities, fetchEnvironmentalData, loadBikePaths, fetchParks]);

  useEffect(() => {
    if (healthcareFacilities) {
      generateAccessPolygons();
    }
  }, [healthcareFacilities, generateAccessPolygons]);

  const toggleLayer = (layerName) => {
    setLayerVisibility(prev => ({
      ...prev,
      [layerName]: !prev[layerName]
    }));
  };

  const { current: map } = useMap();

  const getUserLocation = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newUserLocation = [position.coords.longitude, position.coords.latitude];
          setUserLocation(newUserLocation);
          setViewport({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            zoom: 14,
          });
        },
        (error) => {
          console.error("Error getting user location:", error);
        }
      );
    } else {
      console.error("Geolocation is not supported by this browser.");
    }
  }, []);

  useEffect(() => {
    getUserLocation();
  }, [getUserLocation]);

  const findBestEnvironmentalParcel = useCallback(() => {
    if (!userLocation || !environmentalData) return null;

    const userPoint = point(userLocation);
    const buffer2Miles = buffer(userPoint, 2, { units: 'miles' });

    const parcelsInRange = environmentalData.features.filter(feature => 
      booleanPointInPolygon(center(feature), buffer2Miles)
    );

    return parcelsInRange.reduce((best, current) => 
      (current.properties.percentile > best.properties.percentile) ? current : best
    );
  }, [userLocation, environmentalData]);

  const findBiggestParkOrTrail = useCallback((parcel) => {
    if (!parks || !bikePaths) return null;

    const parksInParcel = parks.features.filter(park => 
      booleanPointInPolygon(center(park), parcel)
    );

    if (parksInParcel.length > 0) {
      return parksInParcel.reduce((biggest, current) => 
        (current.properties.acres > biggest.properties.acres) ? current : biggest
      );
    }

    // If no parks, find a trail
    const trailsInParcel = bikePaths.features.filter(trail => 
      booleanPointInPolygon(center(trail), parcel)
    );

    return trailsInParcel.length > 0 ? trailsInParcel[0] : null;
  }, [parks, bikePaths]);

  const buildHealthyPlan = useCallback(async () => {
    const bestParcel = findBestEnvironmentalParcel();
    if (bestParcel) {
      const bestLocation = findBiggestParkOrTrail(bestParcel);
      if (bestLocation) {
        const guide = await generateParkGuide(bestLocation);
        setHealthyPlan({
          type: bestLocation.geometry.type === 'Polygon' ? 'Park' : 'Trail',
          location: bestLocation,
          environmentalRating: bestParcel.properties.percentile,
          guide: guide,
        });

        // Pan to the recommended location
        const [longitude, latitude] = center(bestLocation).geometry.coordinates;
        if (map) {
          map.flyTo({
            center: [longitude, latitude],
            zoom: 15,
            duration: 2000
          });
        }
      }
    }
  }, [findBestEnvironmentalParcel, findBiggestParkOrTrail, map]);

  const environmentalDataLayer = {
    id: 'environmental-data',
    type: 'fill',
    paint: {
      'fill-color': [
        'interpolate',
        ['linear'],
        ['get', 'percentile'],
        0, '#8b0000',  // dark red for worst
        0.25, '#ff0000', // red
        0.5, '#ff00ff', // magenta for middle
        0.75, '#0000ff', // blue
        1, '#00008b'  // dark blue for best
      ],
      'fill-opacity': 0.2
    }
  };

  const accessPolygonsLayer = {
    id: 'access-polygons',
    type: 'fill',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': 0.5
    }
  };

  const bikePathsLayer = {
    id: 'bike-paths',
    type: 'line',
    paint: {
      'line-color': 'limegreen',
      'line-width': 4,
      'line-opacity': 1,
      'line-outline-color': 'white',
      'line-outline-width': 1
    }
  };

  const parksLayer = {
    id: 'parks',
    type: 'fill',
    paint: {
      'fill-color': 'darkgreen',
      'fill-opacity': 0.7,
      'fill-outline-color': 'limegreen',
      'fill-outline-width': 2
    }
  };

  const handleParkClick = useCallback((event) => {
    const feature = event.features[0];
    if (feature) {
      const [minLng, minLat, maxLng, maxLat] = bbox(feature);
      const centerLng = (minLng + maxLng) / 2;
      const centerLat = (minLat + maxLat) / 2;
      setSelectedPark({
        ...feature,
        center: [centerLng, centerLat]
      });
    }
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <Map
        {...viewport}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/dark-v10"
        mapboxAccessToken={MAPBOX_TOKEN}
        onMove={(evt) => setViewport(evt.viewState)}
        interactiveLayerIds={['parks']}
        onClick={handleParkClick}
      >
        {environmentalData && layerVisibility.environmental && (
          <Source type="geojson" data={environmentalData}>
            <Layer {...environmentalDataLayer} />
          </Source>
        )}
        {accessPolygons && layerVisibility.healthcare && (
          <Source type="geojson" data={accessPolygons}>
            <Layer {...accessPolygonsLayer} />
          </Source>
        )}
        {healthcareFacilities && layerVisibility.healthcare && (
          healthcareFacilities.features.map((facility, index) => (
            <Marker
              key={index}
              longitude={facility.geometry.coordinates[0]}
              latitude={facility.geometry.coordinates[1]}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 21h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18v-2H3v2zm0-4h18V7H3v2zm0-6v2h18V3H3z" fill="#1e90ff"/>
              </svg>
            </Marker>
          ))
        )}
        {bikePaths && layerVisibility.bikePaths && (
          <Source type="geojson" data={bikePaths}>
            <Layer {...bikePathsLayer} />
          </Source>
        )}
        {parks && layerVisibility.bikePaths && (
          <Source type="geojson" data={parks}>
            <Layer {...parksLayer} />
          </Source>
        )}
        {selectedPark && (
          <Popup
            longitude={selectedPark.center[0]}
            latitude={selectedPark.center[1]}
            onClose={() => setSelectedPark(null)}
            closeButton={true}
            closeOnClick={false}
          >
            <ParkPopup park={selectedPark} onClose={() => setSelectedPark(null)} />
          </Popup>
        )}
        {userLocation && (
          <Marker longitude={userLocation[0]} latitude={userLocation[1]}>
            <div style={{ color: 'red', fontSize: '24px' }}>📍</div>
          </Marker>
        )}

{healthyPlan && (
          <Popup
            longitude={center(healthyPlan.location).geometry.coordinates[0]}
            latitude={center(healthyPlan.location).geometry.coordinates[1]}
            onClose={() => setHealthyPlan(null)}
            closeButton={true}
            closeOnClick={false}
            maxWidth="800px"
          >
            <div style={{ width: '600px', maxHeight: '700px', overflowY: 'auto' }}>
              <h3>Your Healthy Plan</h3>
              <p><strong>Type:</strong> {healthyPlan.type}</p>
              <p><strong>Environmental Rating:</strong> {(healthyPlan.environmentalRating * 100).toFixed(2)}%</p>
              {healthyPlan.guide && (
                <div>
                  <h4>Park Guide</h4>
                  <p>{healthyPlan.guide}</p>
                </div>
              )}
              {healthyPlan.type === 'Park' && (
                <div>
                  <h4>Park Details</h4>
                  <p><strong>Name:</strong> {healthyPlan.location.properties.full_name || healthyPlan.location.properties.common_name}</p>
                  <p><strong>Address:</strong> {healthyPlan.location.properties.address_lo}</p>
                  <p><strong>Size:</strong> {healthyPlan.location.properties.acres.toFixed(2)} acres</p>
                  <p>
                    <strong>Directions: </strong>
                    <a 
                      href={`https://www.google.com/maps/search/?api=1&query=${center(healthyPlan.location).geometry.coordinates[1]},${center(healthyPlan.location).geometry.coordinates[0]}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                    >
                      Click here for directions
                    </a>
                  </p>
                </div>
              )}
              {healthyPlan.type === 'Trail' && (
                <p><strong>Trail Name:</strong> {healthyPlan.location.properties.name || 'Unnamed Trail'}</p>
              )}
            </div>
          </Popup>
        )}
      </Map>
      <Legend layerVisibility={layerVisibility} toggleLayer={toggleLayer} />
      <button
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          padding: '10px',
          fontSize: '16px',
          backgroundColor: '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer'
        }}
        onClick={buildHealthyPlan}
      >
        Build me a healthy plan
      </button>
    </div>
  );
};

export default MapComponent;
