#pragma once
 
#include "../device/device.hpp"
 
// std
#include <memory>
#include <unordered_map>
#include <vector>
 
namespace NugieVulkan {
  class DescriptorPool {
    public:
      class Builder {
      public:
        Builder(Device* device) : device{device} {}
    
        Builder& addPoolSize(VkDescriptorType descriptorType, uint32_t count);
        Builder& setPoolFlags(VkDescriptorPoolCreateFlags flags);
        Builder& setMaxSets(uint32_t count);
        DescriptorPool* build() const;
    
      private:
        Device* device = nullptr;
        std::vector<VkDescriptorPoolSize> poolSizes{};
        uint32_t maxSets = 1000;
        VkDescriptorPoolCreateFlags poolFlags = 0;
      };
    
      DescriptorPool(
        Device* device,
        uint32_t maxSets,
        VkDescriptorPoolCreateFlags poolFlags,
        const std::vector<VkDescriptorPoolSize> &poolSizes
      );

      ~DescriptorPool();

      VkDescriptorPool getDescriptorPool() const { return this->descriptorPool; }
    
      bool allocate(VkDescriptorSet* descriptor, const VkDescriptorSetLayout &descriptorSetLayout, const std::vector<uint32_t> &variableSetCounts = {}) const;
      bool allocate(std::vector<VkDescriptorSet> &descriptors, std::vector<VkDescriptorSetLayout> &descriptorSetLayout, const std::vector<uint32_t> &variableSetCounts = {}) const;

      void free(VkDescriptorSet* descriptors) const;
      void free(const std::vector<VkDescriptorSet> &descriptors) const;

      void reset();
    
    private:
      Device* device = nullptr;
      VkDescriptorPool descriptorPool;
  };
}