#pragma once

#include "terrain_mesh.hpp"
#include "../terrain_point/terrain_points.hpp"
#include "../../../general_struct.hpp"

namespace NugieApp {
  class PatchedTerrainMesh : public TerrainMesh {
    public:
      PatchedTerrainMesh(TerrainPoints* terrainPoints, float worldScale = 1.0f);
    
    protected:
      void generateIndices(TerrainPoints* terrainPoints, float worldScale) override;
  };
}