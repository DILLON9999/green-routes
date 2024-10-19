import React, { useState, useEffect, useCallback } from 'react';
import Map, { Source, Layer, Marker, useMap } from 'react-map-gl';
import axios from 'axios';
import { center, point, buffer, booleanPointInPolygon } from '@turf/turf';
import 'mapbox-gl/dist/mapbox-gl.css';
import bikePathsData from './geo_data/bike_routes_datasd.geojson';
import ReactMarkdown from 'react-markdown';

const SD_BOUNDS = [-117.6, 32.5, -116.1, 33.5]; // [west, south, east, north]
const CHATGPT_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

const MAPBOX_TOKEN = process.env.REACT_APP_MAPBOX_TOKEN;
const CHATGPT_API_KEY = process.env.REACT_APP_CHATGPT_API_KEY;

const MapComponent = () => {
  const [viewport, setViewport] = useState({
    latitude: 32.7157,
    longitude: -117.1611,
    zoom: 10,
  });
  const [environmentalData, setEnvironmentalData] = useState(null);
  const [bikePaths, setBikePaths] = useState(null);
  const [parks, setParks] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [healthyPlan, setHealthyPlan] = useState(null);

  // const [highlightedTrail, setHighlightedTrail] = useState(null);
  const [bikePathsContent, setBikePathsContent] = useState(null);

  const [selectedParkId, setSelectedParkId] = useState(null);
  const [route, setRoute] = useState(null);

  useEffect(() => {
    const fetchBikePathsData = async () => {
      try {
        const response = await fetch('/bike_routes_datasd.geojson');
        const data = await response.json();
        setBikePathsContent(data);
      } catch (error) {
        console.error('Error fetching bike paths data:', error);
      }
    };

    fetchBikePathsData();
  }, []);

  const isWithinSanDiego = useCallback(([lon, lat]) => {
    return lon >= SD_BOUNDS[0] && lon <= SD_BOUNDS[2] &&
           lat >= SD_BOUNDS[1] && lat <= SD_BOUNDS[3];
  }, []);

  const generateParkGuide = useCallback(async (park) => {
    const parkInfo = park.properties;
    const prompt = `Create a fun, user-readable guide about the following park (2-3 sentences):
    ${parkInfo.full_name || parkInfo.common_name} is a ${parkInfo.acres.toFixed(2)}-acre ${parkInfo.desig_use} located in ${parkInfo.community}. 
    Facilities: ${Object.entries(parkInfo)
      .filter(([key, value]) => ['tennis', 'basketball', 'playground', 'baseball_90', 'baseball_50_6', 'softball', 'sand_vball', 'multi_purpose', 'concession_stand', 'comfort_station', 'field_lighting', 'recycled_water'].includes(key) && value)
      .map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`)
      .join(', ')}
    Highlight its main features and why someone might want to visit.
    This guide is being used to give users an easy, healthy outside plan.
    Give suggestions about what they can do in the form of a short list, 3-4 bullet points.
    Format the response using Markdown, including bold text for emphasis and bullet points for listing features. The title should be H3

`;

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

  }, []);

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


  useEffect(() => {
    fetchEnvironmentalData();
    loadBikePaths();
    fetchParks();
  }, [fetchEnvironmentalData, loadBikePaths, fetchParks]);

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
    if (!userLocation || !environmentalData || !parks) return null;
  
    const userPoint = point(userLocation);
    const buffer2Miles = buffer(userPoint, 2, { units: 'miles' });
  
    const parcelsInRange = environmentalData.features
      .filter(feature => booleanPointInPolygon(center(feature), buffer2Miles))
      .sort((a, b) => b.properties.percentile - a.properties.percentile);
  
    for (const parcel of parcelsInRange) {
      const parksInParcel = parks.features.filter(park => 
        booleanPointInPolygon(center(park), parcel)
      );
  
      if (parksInParcel.length > 0) {
        return parcel;
      }
    }
  
    return null;
  }, [userLocation, environmentalData, parks]);

  // const findNearestTrail = useCallback((start, end) => {
  //   if (!bikePathsContent || !bikePathsContent.features) return null;

  //   let nearestTrail = null;
  //   let minDistance = Infinity;

  //   const startPoint = point(start);
  //   const endPoint = point(end);

  //   bikePathsContent.features.forEach(trail => {
  //     const coordinates = trail.geometry.coordinates;
  //     const trailStart = coordinates[0];
  //     const trailEnd = coordinates[coordinates.length - 1];

  //             // Handle case where trailEnd is an array of coordinates
  //             const trailEndCoord = Array.isArray(trailEnd[0]) ? trailEnd[trailEnd.length - 1] : trailEnd;
  //             const trailStartCoord = Array.isArray(trailStart[0]) ? trailStart[trailStart.length - 1] : trailStart;

  //     const trailStartPoint = point(trailStartCoord);
  //     const trailEndPoint = point(trailEndCoord);

  //     const distanceToStart = distance(startPoint, trailStartPoint);
  //     const distanceToEnd = distance(endPoint, trailEndPoint);
  //     const totalDistance = distanceToStart + distanceToEnd;

  //     if (totalDistance < minDistance) {
  //       minDistance = totalDistance;
  //       nearestTrail = trail;
  //     }
  //   });

  //   return nearestTrail;
  // }, [bikePathsContent]);

  // const ensurePoint = (coord) => {
  //   if (coord.type === 'Feature' && coord.geometry.type === 'Point') {
  //     return coord;
  //   } else if (Array.isArray(coord) && coord.length === 2) {
  //     return point(coord);
  //   } else {
  //     console.error('Invalid coordinate', coord);
  //     return null;
  //   }
  // };

  // const highlightTrail = useCallback((trail, start, end) => {
  //   try {
  //     // Ensure trail is a valid GeoJSON LineString
  //     if (trail.type !== 'Feature' || trail.geometry.type !== 'LineString') {
  //       console.error('Invalid trail object', trail);
  //       return null;
  //     }

  //     const coordinates = trail.geometry.coordinates;
  //     if (coordinates.length < 2) {
  //       console.error('Not enough coordinates in the trail');
  //       return null;
  //     }

  //     // Ensure start and end are valid GeoJSON Point features
  //     const startPoint = ensurePoint(start);
  //     const endPoint = ensurePoint(end);

  //     if (!startPoint || !endPoint) {
  //       console.error('Invalid start or end point');
  //       return null;
  //     }

  //     // Create a FeatureCollection of points from the trail coordinates
  //     const pointsCollection = featureCollection(
  //       coordinates.map(coord => point(coord))
  //     );

  //     const nearestStartPoint = nearestPoint(startPoint, pointsCollection);
  //     const nearestEndPoint = nearestPoint(endPoint, pointsCollection);

  //     if (!nearestStartPoint || !nearestEndPoint) {
  //       console.error('Could not find nearest points on the trail');
  //       return null;
  //     }

  //     const startIndex = coordinates.findIndex(coord => 
  //       coord[0] === nearestStartPoint.geometry.coordinates[0] && 
  //       coord[1] === nearestStartPoint.geometry.coordinates[1]
  //     );
  //     const endIndex = coordinates.findIndex(coord => 
  //       coord[0] === nearestEndPoint.geometry.coordinates[0] && 
  //       coord[1] === nearestEndPoint.geometry.coordinates[1]
  //     );

  //     if (startIndex === -1 || endIndex === -1) {
  //       console.error('Could not find start or end index in coordinates');
  //       return null;
  //     }

  //     const slicedCoordinates = coordinates.slice(
  //       Math.min(startIndex, endIndex),
  //       Math.max(startIndex, endIndex) + 1
  //     );

  //     return {
  //       type: 'Feature',
  //       properties: { ...trail.properties, highlighted: true },
  //       geometry: {
  //         type: 'LineString',
  //         coordinates: slicedCoordinates
  //       }
  //     };
  //   } catch (error) {
  //     console.error('Error in highlightTrail:', error);
  //     return null;
  //   }
  // }, []);

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

  const getRoute = useCallback(async (start, end) => {
    try {
      const response = await axios.get(
        `https://api.mapbox.com/directions/v5/mapbox/walking/${start[0]},${start[1]};${end[0]},${end[1]}`,
        {
          params: {
            access_token: MAPBOX_TOKEN,
            geometries: 'geojson',
            steps: true,
            overview: 'full',
          },
        }
      );

      const route = response.data.routes[0];
      return {
        type: 'Feature',
        properties: {},
        geometry: route.geometry,
      };
    } catch (error) {
      console.error('Error fetching route:', error);
      return null;
    }
  }, []);


  const buildHealthyPlan = useCallback(async () => {
    const bestParcel = findBestEnvironmentalParcel();
    if (bestParcel) {
      const bestLocation = findBiggestParkOrTrail(bestParcel);
      if (bestLocation) {
        const guide = await generateParkGuide(bestLocation);
        
        // Find and highlight the nearest trail
        if (userLocation && bikePathsContent) {
          const parkCenter = center(bestLocation).geometry.coordinates;
          // const nearestTrail = findNearestTrail(userLocation, parkCenter);
          // if (nearestTrail) {
          //   const highlightedTrailFeature = highlightTrail(nearestTrail, userLocation, parkCenter);
          //   setHighlightedTrail(highlightedTrailFeature);
          // }

          // Get the route between user location and park
          const routeGeojson = await getRoute(userLocation, parkCenter);
          setRoute(routeGeojson);
        }

        setHealthyPlan({
          type: bestLocation.geometry.type === 'Polygon' ? 'Park' : 'Trail',
          location: bestLocation,
          environmentalRating: bestParcel.properties.percentile,
          guide: guide,
        });

        // Set the selected park ID
        if (bestLocation && parks) {
          const parkId = bestLocation.properties.common_name;
        
          if (parkId) {
            setSelectedParkId(parkId);
        
            const updatedParks = {
              ...parks,
              features: parks.features.map(park => ({
                ...park,
                properties: {
                  ...park.properties,
                  selected: park.properties.common_name === parkId
                }
              }))
            };
        
            setParks(updatedParks);
          } else {
            console.error('No valid common_name for the selected park');
          }
        }
          
        // Pan to the recommended location
        const [longitude, latitude] = center(bestLocation).geometry.coordinates;
        if (map) {
          map.flyTo({
            center: [longitude, latitude],
            zoom: 13, // Zoomed out slightly to show more context
            duration: 2000
          });
        }
      }
    }
  }, [findBestEnvironmentalParcel, generateParkGuide, findBiggestParkOrTrail, map, parks, bikePathsContent, getRoute, userLocation]);

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
      'fill-color': [
        'case',
        ['==', ['get', 'common_name'], selectedParkId], // Compare common_name instead of OBJECTID
        'red', // Highlight selected park in red
        'darkgreen' // Default color for unselected parks
      ],
      'fill-opacity': 0.7,
      'fill-outline-color': 'limegreen'
    }
  };
      
  const routeLayer = {
    id: 'route',
    type: 'line',
    paint: {
      'line-color': '#3887be',
      'line-width': 5,
      'line-opacity': 0.75
    }
  };

  // const highlightedTrailLayer = {
  //   id: 'highlighted-trail',
  //   type: 'line',
  //   paint: {
  //     'line-color': 'red',
  //     'line-width': 6,
  //     'line-opacity': 1
  //   }
  // };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <Map
        {...viewport}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/dark-v10"
        mapboxAccessToken={MAPBOX_TOKEN}
        onMove={(evt) => setViewport(evt.viewState)}
        interactiveLayerIds={['parks']}
      >
        {environmentalData && (
          <Source type="geojson" data={environmentalData}>
            <Layer {...environmentalDataLayer} />
          </Source>
        )}
        {bikePaths && (
          <Source type="geojson" data={bikePaths}>
            <Layer {...bikePathsLayer} />
          </Source>
        )}
        {parks && (
          <Source key={selectedParkId} type="geojson" data={parks}>
            <Layer {...parksLayer} />
          </Source>
        )}
        {userLocation && (
          <Marker longitude={userLocation[0]} latitude={userLocation[1]}>
            <div style={{ color: 'red', fontSize: '24px' }}>📍</div>
          </Marker>
        )}
        {/* {highlightedTrail && (
          <Source type="geojson" data={highlightedTrail}>
            <Layer {...highlightedTrailLayer} />
          </Source>
        )} */}
        {route && (
          <Source type="geojson" data={route}>
            <Layer {...routeLayer} />
          </Source>
        )}
      </Map>
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
      {healthyPlan && (
        <div
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            width: '300px',
            maxHeight: '80vh',
            overflowY: 'auto',
            backgroundColor: 'white',
            padding: '15px',
            borderRadius: '5px',
            boxShadow: '0 2px 10px rgba(0,0,0,0.3)'
          }}
        >
          <h3>Your Healthy Plan</h3>
          <p><strong>Type:</strong> {healthyPlan.type}</p>
          <p><strong>Environmental Rating:</strong> {(healthyPlan.environmentalRating * 100).toFixed(2)}%</p>
          {healthyPlan.guide && (
            <div>
              <h4>Park Guide</h4>
              <ReactMarkdown>{healthyPlan.guide}</ReactMarkdown>
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
      )}
    </div>
  );
};


export default MapComponent;