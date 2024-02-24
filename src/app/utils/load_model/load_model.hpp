#pragma once

#include "../../general_struct.hpp"
#include <string>

namespace NugieApp {
  struct LoadedModel {
    std::vector<Vertex> vertices;
    std::vector<Primitive> primitives;
  };

  LoadedModel loadObjModel(const std::string &filePath, uint32_t materialIndex, uint32_t offsetIndex = 0);
}