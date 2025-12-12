import { MapContainer, TileLayer } from "react-leaflet";
import "./App.css";


function App(){

  

  return(
    <MapContainer
      center={[31.9048, 77.1734]}
      zoom={11}
      scrollWheelZoom={true}
      minZoom={9}
      maxZoom={18}
      maxBounds={[
        [30.22,75.63],
        [33.22,79.04]
        ]}
        maxBoundsViscosity={1}
      className="map"
    >
      <TileLayer
        url="https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png"
        attribution="&copy; OpenStreetMap contributors"
        detectRetina={true}
        crossOrigin={true}
      />


    </MapContainer>
  )
}

export default App
