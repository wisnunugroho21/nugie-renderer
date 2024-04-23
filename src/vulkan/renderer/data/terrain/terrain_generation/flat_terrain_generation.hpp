#pragma once

#include "terrain_generation.hpp"
#include "../terrain_point/terrain_points.hpp"
#include "../../../general_struct.hpp"

namespace NugieApp {
  class FlatTerrainGeneration : public TerrainGeneration { 
    public:
      FlatTerrainGeneration(uint32_t terrainSize, float terrainHeight = 0.0f);
      
    private:
      void generateTerrainPoints(uint32_t terrainSize, float terrainHeight = 0.0f);
  };
}