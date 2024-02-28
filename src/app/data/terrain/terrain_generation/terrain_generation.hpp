#pragma once

#include "../../../general_struct.hpp"

namespace NugieApp {
  class TerrainGeneration
  { 
    private:
      const char* filePath;

    public:
      TerrainGeneration(const char* filePath);
      std::vector<float> generateTerrainPoints();
  };
}