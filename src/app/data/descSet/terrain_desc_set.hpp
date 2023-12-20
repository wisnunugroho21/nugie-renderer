#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../../vulkan/descriptor/descriptor_set_layout.hpp"

#include <memory>

namespace NugieApp {
	class TerrainDescSet {
		public:
			TerrainDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool,
				std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1]);
			~TerrainDescSet();

			VkDescriptorSet getDescriptorSets(int frameIndex) const { return this->descriptorSets[frameIndex]; }
			NugieVulkan::DescriptorSetLayout* getDescSetLayout() const { return this->descSetLayout; }

			void overwrite(std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1]);

		private:
			NugieVulkan::Device* device;
			NugieVulkan::DescriptorPool* descriptorPool;

      NugieVulkan::DescriptorSetLayout* descSetLayout;
			std::vector<VkDescriptorSet> descriptorSets;

			void createDescriptorLayout();
			void createDescriptorSet(std::vector<VkDescriptorBufferInfo> uniformBufferInfo[1]);
	};
	
}