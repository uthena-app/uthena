# ADR-0001: Bunny.net for video streaming and object storage

**Date:** 2026-06-12
**Status:** Accepted
**Deciders:** Human, platform agent

## Context

We need to serve 5TB+ of licensed video content to customers worldwide. The content is PLR courses (varying lengths, 720p–4K) and digital assets (PDFs, ZIPs, etc.). We need:

1. **Video streaming** with adaptive bitrate (HLS), global CDN, low startup latency
2. **Object storage** for original uploads (the "cold" tier) and digital assets
3. **Signed URLs** with TTL for both streams and downloads
4. **Webhook events** when transcoding completes
5. **Cost predictability** — we know we'll grow

## Considered options

### Option A: AWS S3 + CloudFront + MediaConvert

- **Pros:** Mature, well-documented, integrates with everything. S3 is the de facto standard. CloudFront is fast. MediaConvert is good for video.
- **Cons:** Pricing is a maze. MediaConvert costs add up. CloudFront egress is expensive at scale. We'd be paying for services we don't fully use.

### Option B: Mux

- **Pros:** Best-in-class developer experience for video. Mux Video handles HLS, thumbnails, analytics. Pricing is per-minute-streamed.
- **Cons:** Separate object storage needed (Mux is video-only). Per-minute pricing is unpredictable for our volume. We don't need the analytics we don't use.

### Option C: Cloudflare Stream + R2

- **Pros:** Cloudflare's CDN is excellent. Stream is simple. R2 has no egress fees.
- **Cons:** Stream is video-only (still need object storage for non-video). Stream's pricing is per-minute of stored + delivered. Less mature than Bunny for video specifically.

### Option D: Bunny.net (Stream + Storage)

- **Pros:** Single vendor for both. Simple pricing ($0.01/GB storage, $0.01/GB egress from EU, $0.005/GB in NA). Stream has built-in transcoding to HLS. Storage integrates with Stream. Webhooks for transcoding completion. Has a signed URL system.
- **Cons:** Smaller vendor than AWS. Some advanced features (e.g. per-title encoding) require higher tiers. Documentation is decent but not as deep as AWS.

## Decision

**Bunny.net (Stream + Storage).**

The decision is primarily about cost predictability and simplicity. At our projected volume (5TB+ storage, ~50TB egress/month), Bunny is roughly 1/3 the cost of AWS, with a much simpler pricing model. The "single vendor" benefit (one dashboard, one API, one webhook system) is significant for a small team.

We accept the risk of a smaller vendor because:
- Bunny has been in business since 2015 and serves a significant portion of the indie media market
- Our usage patterns are not exotic (HLS streaming, signed URLs, basic webhooks)
- Migration to a different vendor is possible (signed URLs are standard, HLS is standard)

## Consequences

### Positive

- **Predictable monthly cost.** We can model it from the specs: storage + egress + transcoding minutes.
- **One vendor for video + assets.** Less to integrate, less to monitor, less to pay.
- **HLS out of the box.** We don't need to run our own transcoding pipeline for v1.
- **Webhook for transcoding completion** is built-in.

### Negative

- **Vendor lock-in on the dashboard.** The Bunny Dashboard is where we configure zones, CDN, and webhooks. If we migrate, we re-do that config.
- **Limited analytics.** Bunny's analytics are basic. We can't easily answer "which videos have the highest completion rate" without our own tracking.
- **No built-in DRM.** For v1 this is fine (signed URLs + IP binding is enough). For v2, we may need Widevine or FairPlay, which would require either a different vendor or a separate DRM layer.

### Mitigations

- **Track our own video analytics** (we already plan to — events on player load, pause, seek, complete). This is captured in `04-platform/observability/`.
- **IP binding + 4h TTL on streams** is our anti-piracy measure for v1. Watermarking is in v2.
- **Multi-CDN fallback** is on the v2 roadmap. Not needed in v1.

## References

- Bunny.net Stream docs: https://docs.bunny.net/docs/stream
- Bunny.net Storage docs: https://docs.bunny.net/docs/storage
- The signed URL contract: `00-foundations/files/README.md`
- The 3-tier storage model: `04-platform/storage/README.md`
