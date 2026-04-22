// Haversine formula — distance in km between two lat/lng points
function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Calculate suggested price for a printer + job combination
function calcSuggestedPrice(printer, job) {
  const materialPrices = printer.material_prices || {};
  const materialCostPerG = materialPrices[job.material] || 1.0;
  const materialCost = materialCostPerG * (job.estimated_weight_g || 0);
  const machineCost = printer.rate_per_hour * (job.estimated_time_hr || 0);

  const complexityMultiplier =
    job.complexity === 'complex' ? 1.4
    : job.complexity === 'medium' ? 1.2
    : 1.0;

  const rushMultiplier = job.is_rush ? 1.3 : 1.0;

  return parseFloat(
    (materialCost + machineCost) * complexityMultiplier * rushMultiplier
  ).toFixed(2);
}

// Match score: 0-1 (higher = better match)
function calcMatchScore(printer, printerUser, job, commissionerUser) {
  // Distance score (100km radius, 0 beyond that)
  const distKm = getDistanceKm(
    commissionerUser.latitude,
    commissionerUser.longitude,
    printerUser.latitude,
    printerUser.longitude
  );
  const distanceScore = Math.max(0, 1 - distKm / 100);

  // Review score (avg_rating / 5)
  const reviewScore = (printer.avg_rating || 0) / 5;

  // Price score (cheaper relative to budget = higher)
  const suggested = parseFloat(calcSuggestedPrice(printer, job));
  const priceScore =
    suggested <= job.budget_max
      ? Math.max(0, 1 - suggested / job.budget_max)
      : 0; // over budget = score 0

  // Experience score (caps at 50 jobs)
  const jobsScore = Math.min((printer.jobs_completed || 0) / 50, 1);

  // Failure penalty (5% per failure, max 30%)
  const failurePenalty = Math.min((printer.failure_count || 0) * 0.05, 0.3);

  const score =
    distanceScore * 0.3 +
    reviewScore   * 0.35 +
    priceScore    * 0.2 +
    jobsScore     * 0.15 -
    failurePenalty;

  return Math.max(0, parseFloat(score.toFixed(4)));
}

module.exports = { calcMatchScore, calcSuggestedPrice, getDistanceKm };
