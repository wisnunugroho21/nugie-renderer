#pragma once

#include "../../general_struct.hpp"

namespace NugieApp {
  class SkyBox {
    public:
      static std::vector<Vertex> getSkyBoxVertices();
      static std::vector<uint32_t> getSkyBoxIndices();
  };
}