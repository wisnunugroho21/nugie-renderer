#pragma once

#include "../../general_struct.hpp"
#include <string>

namespace NugieApp {
  struct LoadedModel {
    std::vector<Position> positions;
    std::vector<Normal> normals;
    std::vector<TextCoord> textCoords;
    std::vector<uint32_t> indices;
  };

  LoadedModel loadObjModel(const std::string &filePath);
}