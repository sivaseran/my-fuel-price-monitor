export default function StationTabs({ stations, selectedId, onSelect }) {
  return (
    <div className="station-tabs" role="tablist" aria-label="Service station">
      {stations.map((station) => (
        <button
          key={station.id}
          className={selectedId === station.id ? 'station-tab active' : 'station-tab'}
          onClick={() => onSelect(station.id)}
          role="tab"
          aria-selected={selectedId === station.id}
        >
          {station.name}
        </button>
      ))}
    </div>
  );
}
