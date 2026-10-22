import { offset } from '../util/geo';
import { OutlierFilter, PositionSmoother } from './fix-filter';

const at = { lat: 45.5, lng: 9.2 };

describe('OutlierFilter', () => {
  it('drops a coarse fix right after a good one, and takes it once the good ones stop', () => {
    const f = new OutlierFilter();
    expect(f.accept({ ...at, accuracy: 5, timestamp: 0 })).toBe(true);
    expect(f.accept({ ...at, accuracy: 60, timestamp: 2_000 })).toBe(false);
    expect(f.accept({ ...at, accuracy: 8, timestamp: 3_000 })).toBe(true);
    expect(f.accept({ ...at, accuracy: 60, timestamp: 20_000 })).toBe(true);
  });
  it('drops impossible jumps but accepts running speed', () => {
    const f = new OutlierFilter(12);
    expect(f.accept({ ...at, accuracy: 5, timestamp: 0 })).toBe(true);
    expect(f.accept({ ...offset(at, 200, 90), accuracy: 5, timestamp: 2_000 })).toBe(false);
    expect(f.accept({ ...offset(at, 40, 90), accuracy: 5, timestamp: 5_000 })).toBe(true);
  });
});

describe('PositionSmoother', () => {
  it('keeps a standing player close to the true position despite jitter', () => {
    const s = new PositionSmoother();
    let p = at;
    for (let i = 0; i < 20; i++) p = s.next({ ...offset(at, 12, i % 2 ? 0 : 180), accuracy: 12, timestamp: i * 1_000 });
    const err = Math.abs(p.lat - at.lat) * 111_000;
    expect(err).toBeLessThan(6);
  });
  it('follows a fix that is much more precise than the current estimate', () => {
    const s = new PositionSmoother();
    s.next({ ...at, accuracy: 50, timestamp: 0 });
    const target = offset(at, 40, 0);
    const p = s.next({ ...target, accuracy: 3, timestamp: 1_000 });
    expect(Math.abs(p.lat - target.lat) * 111_000).toBeLessThan(2);
  });
});
