#pragma once

#include "../../general_struct.hpp"
#include <string>

namespace NugieApp {
  struct LoadedModel {
    std::vector<glm::vec4> positions;
    std::vector<glm::vec4> normals;
    std::vector<glm::vec2> textCoords;
    std::vector<uint32_t> indices;
  };

  LoadedModel loadObjModel(const std::string &filePath);
}