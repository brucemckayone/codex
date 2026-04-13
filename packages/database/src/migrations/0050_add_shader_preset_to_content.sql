-- Add shader preset and config columns to content table
-- for immersive audio playback mode (audio-reactive shader visualization)

ALTER TABLE "content" ADD COLUMN "shader_preset" varchar(50);
ALTER TABLE "content" ADD COLUMN "shader_config" jsonb;
