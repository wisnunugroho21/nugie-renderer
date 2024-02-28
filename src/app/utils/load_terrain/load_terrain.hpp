#pragma once

#include "../../general_struct.hpp"
#include <string>

namespace NugieApp {
  struct LoadedTerrain {
    std::vector<Position> positions;
    std::vector<uint32_t> indices;
  };

  LoadedTerrain loadTerrain(const char* filePath);
  char* ReadBinaryFile(const char* pFilename, int& size);
}