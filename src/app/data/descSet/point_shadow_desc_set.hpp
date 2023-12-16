#pragma once

#include "../../../vulkan/device/device.hpp"
#include "../../../vulkan/buffer/buffer.hpp"
#include "../../../vulkan/descriptor/descriptor_pool.hpp"
#include "../../../vulkan/descriptor/descriptor_set_layout.hpp"

#include <memory>

namespace NugieApp {
	class PointShadowDescSet {
		public:
			PointShadowDescSet(NugieVulkan::Device* device, NugieVulkan::DescriptorPool* descriptorPool, VkDescriptorBufferInfo modelsInfo[2]);
			~PointShadowDescSet();

			VkDescriptorSet getDescriptorSets(int frameIndex) const { return this->descriptorSets[frameIndex]; }
			NugieVulkan::DescriptorSetLayout* getDescSetLayout() const { return this->descSetLayout; }

			void deleteDescriptorSet();
			void createDescriptorSet(VkDescriptorBufferInfo modelsInfo[2]);

		private:
			NugieVulkan::Device* device;
			NugieVulkan::DescriptorPool* descriptorPool;

      NugieVulkan::DescriptorSetLayout* descSetLayout;
			std::vector<VkDescriptorSet> descriptorSets;

			void createDescriptorLayout();
	};
	
}